import compression from 'compression';
import cors from 'cors';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { eventLoopLagMs, securityHeaders } from './middleware.js';
import { queueStats, runHeavy, SHED } from './queue.js';
import {
  capBreakerTableFor,
  capOverrideFor,
  checkReferentialIntegrity,
  collectBreakpoints,
  crossCheckBadges,
  datasetCoverage,
  computeBudget,
  computeCaps,
  evaluateBuild,
  findDataRoot,
  heightRange,
  listDatasets,
  loadDatasetFromDisk,
  loadSecondSources,
  optimize,
  parseBuildRequest,
  requestFromArchetype,
  validateBody,
  verificationReport,
  weightRange,
  wingspanRange,
  type Dataset,
} from '@2k27/core/node';

const PORT = Number(process.env['PORT'] ?? 4000);
const DEFAULT_DATASET = process.env['DATASET_ID'] ?? '2k27';
const PRODUCTION = process.env['NODE_ENV'] === 'production';

/**
 * Reloading re-reads the dataset from disk and drops the cache. That is exactly
 * what you want while editing JSON locally, and exactly what you do not want
 * exposed anonymously on the internet. In production it requires a token, and
 * if no token is configured the endpoint is simply off.
 */
const RELOAD_TOKEN = process.env['RELOAD_TOKEN'] ?? '';
const reloadEnabled = !PRODUCTION || RELOAD_TOKEN.length > 0;

/**
 * How many searches may be waiting before further ones are refused. Each is
 * 100-400 ms of uninterruptible CPU on a single thread, so a depth of 4 is
 * already up to 1.6 s of backlog — past that, refusing is kinder than queueing.
 */
const MAX_QUEUE_DEPTH = Number(process.env['MAX_QUEUE_DEPTH'] ?? 4);

// ---------------------------------------------------------------------------
// Dataset cache. Datasets are reloaded on demand so you can edit a JSON file
// and hit /api/datasets/2k27/reload without restarting the server.
// ---------------------------------------------------------------------------

interface CacheEntry {
  dataset: Dataset;
  issues: ReturnType<typeof checkReferentialIntegrity>;
  /** Built lazily on first request; see buildReport. */
  report?: { json: string; etag: string };
}

const cache = new Map<string, CacheEntry>();

function getDataset(id: string): CacheEntry {
  let entry = cache.get(id);
  if (!entry) {
    const loaded = loadDatasetFromDisk(id);
    entry = { dataset: loaded.dataset, issues: loaded.issues };
    cache.set(id, entry);
  }
  return entry;
}

/**
 * The full dataset payload the UI loads on startup.
 *
 * It is identical between reloads, but used to be rebuilt per request: the
 * verification, coverage and cross-check reports are recomputed (~2.7 ms) and
 * the 113 KB result re-serialized (~1.7 ms). Both are now done once per load
 * and served from a cached string with an ETag, so a returning client gets a
 * 304 and the server does no work at all.
 */
function buildReport(id: string, entry: CacheEntry): { json: string; etag: string } {
  if (entry.report) return entry.report;
  const json = JSON.stringify({
    dataset: entry.dataset,
    issues: entry.issues,
    verification: verificationReport(entry.dataset),
    coverage: datasetCoverage(entry.dataset),
    crossChecks: loadSecondSources(id).map((source) => crossCheckBadges(entry.dataset, source)),
  });
  entry.report = { json, etag: `W/"${createHash('sha1').update(json).digest('base64url')}"` };
  return entry.report;
}

const app = express();

// Rate limiting is per-IP, so behind a load balancer the app must be told how
// many proxy hops to trust before req.ip means anything. Default 1: the single
// hop that every managed container platform puts in front of you.
app.set('trust proxy', Number(process.env['TRUST_PROXY_HOPS'] ?? 1));
app.disable('x-powered-by');

app.use(securityHeaders);
app.use(compression());

// A public read-only API, so `*` is a reasonable default — but it is the kind
// of default that should be a decision, so it is settable.
const corsOrigin = process.env['CORS_ORIGIN'];
app.use(cors(corsOrigin ? { origin: corsOrigin.split(',').map((s) => s.trim()) } : {}));

// Requests are small: a body vector, priorities and a sentence. 64 KB is
// generous for that and keeps a hostile 1 MB parse off the event loop.
app.use(express.json({ limit: '64kb' }));

const generalLimit = rateLimit({
  windowMs: 60_000,
  limit: Number(process.env['RATE_LIMIT_GENERAL'] ?? 300),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Slow down.' },
});

/**
 * Optimize, describe, evaluate and archetype-optimize all run the search, which
 * is the only expensive thing here. They get a much tighter budget than the
 * lookup endpoints the UI polls while you drag a slider.
 */
const heavyLimit = rateLimit({
  windowMs: 60_000,
  limit: Number(process.env['RATE_LIMIT_OPTIMIZE'] ?? 30),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many optimize requests. Each one is a full search; retry in a moment.' },
});

const heavy: RequestHandler[] = [heavyLimit];

/** Refusal shared by every heavy route, so the wording stays in one place. */
function refuseSaturated(res: Response) {
  res.setHeader('Retry-After', '2');
  res.status(503).json({
    error: 'Server is saturated; this request was refused rather than queued.',
    detail:
      'A build search is synchronous CPU work, so queueing this would slow every other request ' +
      'down instead of just its own. Retry shortly.',
    queue: queueStats(),
  });
}

app.use('/api', generalLimit);

// Mounted by path rather than passed per-route: Express infers a route's params
// from its path string, and threading a middleware array through the handler
// signature loses that inference.
for (const path of [
  '/api/datasets/:id/optimize',
  '/api/datasets/:id/evaluate',
  '/api/datasets/:id/archetype/:archetypeId/optimize',
  '/api/datasets/:id/describe',
]) {
  app.use(path, ...heavy);
}

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const bodySchema = z.object({
  position: z.string(),
  heightInches: z.number().int(),
  weightPounds: z.number().int(),
  wingspanInches: z.number().int(),
});

const optimizeRequestSchema = z.object({
  body: bodySchema,
  priorities: z.record(z.string(), z.number()).default({}),
  minimums: z.record(z.string(), z.number()).optional(),
  softTargets: z.record(z.string(), z.number()).optional(),
  maximums: z.record(z.string(), z.number()).optional(),
  scoreWeights: z.record(z.string(), z.number()).optional(),
  resultCount: z.number().int().min(1).max(6).optional(),
  archetypeId: z.string().optional(),
  useCapBreakers: z.boolean().optional(),
  useBadgeBoosts: z.boolean().optional(),
  tokenOverrides: z.record(z.string(), z.number().nullable()).optional(),
});

const evaluateRequestSchema = z.object({
  body: bodySchema,
  attributes: z.record(z.string(), z.number()),
  priorities: z.record(z.string(), z.number()).optional(),
  minimums: z.record(z.string(), z.number()).optional(),
  softTargets: z.record(z.string(), z.number()).optional(),
  useCapBreakers: z.boolean().optional(),
  useBadgeBoosts: z.boolean().optional(),
  tokenOverrides: z.record(z.string(), z.number().nullable()).optional(),
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * Liveness plus the two numbers that explain a slow response, so a saturated
 * instance can be told apart from a broken one without shelling in.
 */
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    datasets: listDatasets(),
    dataRoot: findDataRoot(),
    reloadEnabled,
    load: { ...queueStats(), eventLoopLagMs: Math.round(eventLoopLagMs() * 10) / 10 },
    uptimeSeconds: Math.round(process.uptime()),
  });
});

/** Everything the client needs to render the builder, in one payload. */
app.get('/api/datasets/:id', (req, res) => {
  const entry = getDataset(req.params.id);
  const { json, etag } = buildReport(req.params.id, entry);
  res.setHeader('ETag', etag);
  // The payload only changes on reload, and the client revalidates each load.
  res.setHeader('Cache-Control', 'no-cache');
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }
  res.type('application/json').send(json);
});

app.post('/api/datasets/:id/reload', (req, res) => {
  if (!reloadEnabled) {
    res.status(404).json({
      error: 'Reloading is disabled. Set RELOAD_TOKEN to enable it in production.',
    });
    return;
  }
  if (PRODUCTION && req.get('x-reload-token') !== RELOAD_TOKEN) {
    res.status(401).json({ error: 'Missing or incorrect x-reload-token.' });
    return;
  }
  cache.delete(req.params.id);
  const { dataset, issues } = getDataset(req.params.id);
  res.json({
    reloaded: true,
    datasetVersion: dataset.meta.datasetVersion,
    errors: issues.filter((i) => i.severity === 'error'),
    warnings: issues.filter((i) => i.severity === 'warning'),
  });
});

/** Legal slider ranges for a position/height, so the UI never offers an illegal body. */
app.get('/api/datasets/:id/body-options', (req, res) => {
  const { dataset } = getDataset(req.params.id);
  const position = String(req.query['position'] ?? dataset.positions[0]!.id);
  const heights = heightRange(dataset, position);
  const height = Number(req.query['height'] ?? Math.round((heights.min + heights.max) / 2));
  const weight = req.query['weight'] !== undefined ? Number(req.query['weight']) : undefined;

  res.json({
    position,
    height: heights,
    weight: weightRange(dataset, position, height),
    wingspan: wingspanRange(dataset, position, height, weight),
  });
});

/** Caps + budget for one body. Drives the live cap bars in the builder. */
app.get('/api/datasets/:id/caps', (req, res) => {
  const { dataset } = getDataset(req.params.id);
  const parsed = bodySchema.safeParse({
    position: String(req.query['position']),
    heightInches: Number(req.query['height']),
    weightPounds: Number(req.query['weight']),
    wingspanInches: Number(req.query['wingspan']),
  });
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', details: parsed.error.issues });
    return;
  }
  const validation = validateBody(dataset, parsed.data);
  const body = validation.corrected;
  res.json({
    body,
    validation: { valid: validation.valid, errors: validation.errors, ranges: validation.ranges },
    caps: computeCaps(dataset, body),
    budget: computeBudget(dataset, body),
    // Whether these caps came off the real builder or out of the linear model
    // is the single most important thing to know about them.
    capsSource: capOverrideFor(dataset, body) ? 'transcribed' : 'modelled',
    capBreakers: capBreakerTableFor(dataset, body),
    inGameBuildName:
      dataset.officialBuildNames?.entries[
        `${body.position}|${body.heightInches}|${body.weightPounds}|${body.wingspanInches}`
      ] ?? null,
  });
});

/** Threshold map for one body: what each rating on each attribute unlocks. */
app.get('/api/datasets/:id/breakpoints', (req, res) => {
  const { dataset } = getDataset(req.params.id);
  const parsed = bodySchema.safeParse({
    position: String(req.query['position']),
    heightInches: Number(req.query['height']),
    weightPounds: Number(req.query['weight']),
    wingspanInches: Number(req.query['wingspan']),
  });
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', details: parsed.error.issues });
    return;
  }
  const body = validateBody(dataset, parsed.data).corrected;
  const caps = computeCaps(dataset, body);
  res.json({ body, breakpoints: collectBreakpoints(dataset, body, caps, {}) });
});

app.post('/api/datasets/:id/optimize', async (req, res, next) => {
  const { dataset } = getDataset(req.params.id);
  const parsed = optimizeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid optimize request', details: parsed.error.issues });
    return;
  }
  try {
    const result = await runHeavy(MAX_QUEUE_DEPTH, () => optimize(dataset, parsed.data));
    if (result === SHED) return refuseSaturated(res);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post('/api/datasets/:id/evaluate', async (req, res, next) => {
  const { dataset } = getDataset(req.params.id);
  const parsed = evaluateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid evaluate request', details: parsed.error.issues });
    return;
  }
  const body = validateBody(dataset, parsed.data.body).corrected;
  try {
    const result = await runHeavy(MAX_QUEUE_DEPTH, () =>
      evaluateBuild(dataset, body, parsed.data.attributes, {
        priorities: parsed.data.priorities ?? {},
        minimums: parsed.data.minimums,
        softTargets: parsed.data.softTargets,
        useCapBreakers: parsed.data.useCapBreakers,
        useBadgeBoosts: parsed.data.useBadgeBoosts,
        tokenOverrides: parsed.data.tokenOverrides,
      })
    );
    if (result === SHED) return refuseSaturated(res);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post('/api/datasets/:id/archetype/:archetypeId/optimize', async (req, res) => {
  const { dataset } = getDataset(req.params.id);
  const overrides = req.body ?? {};
  let request;
  try {
    request = requestFromArchetype(dataset, req.params.archetypeId, overrides);
  } catch (e) {
    res.status(404).json({ error: (e as Error).message });
    return;
  }
  const result = await runHeavy(MAX_QUEUE_DEPTH, () => optimize(dataset, request));
  if (result === SHED) return refuseSaturated(res);
  res.json({ request, result });
});

/** Natural-language "Build Optimizer" mode. */
app.post('/api/datasets/:id/describe', async (req, res) => {
  const { dataset } = getDataset(req.params.id);
  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  if (!text.trim()) {
    res.status(400).json({ error: 'Provide a "text" field describing the build you want.' });
    return;
  }
  if (text.length > 2000) {
    res.status(400).json({ error: 'Description too long; 2000 characters is plenty for a build.' });
    return;
  }
  const parsed = parseBuildRequest(dataset, text);
  // resultCount drives how many full searches run, so it is clamped rather than
  // trusted — the same bound the optimize schema enforces.
  const requested = Number(req.body?.resultCount ?? 3);
  const request = {
    ...parsed.request,
    resultCount: Number.isFinite(requested) ? Math.min(6, Math.max(1, Math.round(requested))) : 3,
    ...(req.body?.tokenOverrides ? { tokenOverrides: req.body.tokenOverrides } : {}),
  };
  const result = await runHeavy(MAX_QUEUE_DEPTH, () => optimize(dataset, request));
  if (result === SHED) return refuseSaturated(res);
  res.json({
    parsed: { notes: parsed.notes, unparsed: parsed.unparsed, bodyInferred: parsed.bodyInferred },
    request,
    result,
  });
});

// ---------------------------------------------------------------------------
// Static hosting for the built web app, so `npm start` serves the whole thing.
// ---------------------------------------------------------------------------

const webDist = process.env['WEB_DIST'] ?? join(findDataRoot(), '..', 'apps', 'web', 'dist');
if (existsSync(webDist)) {
  app.use(
    express.static(webDist, {
      // Vite fingerprints everything under /assets, so those are safe to keep
      // for a year. index.html must never be, or a deploy is invisible until
      // the browser decides to revalidate.
      setHeaders(res, path) {
        res.setHeader(
          'Cache-Control',
          path.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable'
        );
      },
    })
  );
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(join(webDist, 'index.html'));
  });
}

app.use((err: Error & { status?: number; statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
  // Errors raised by middleware (an oversized body, malformed JSON) carry the
  // status they deserve. Without this they all collapsed into a 500, which told
  // the client to retry something that will never succeed.
  const status = err.status ?? err.statusCode ?? 500;
  if (status >= 500) console.error(err);

  if (status < 500) {
    res.status(status).json({ error: err.message });
    return;
  }
  // An exception message can name a filesystem path or a dataset internal.
  // Log it, do not ship it.
  res.status(500).json({ error: PRODUCTION ? 'Internal error.' : err.message });
});

const server = app.listen(PORT, () => {
  const { dataset, issues } = getDataset(DEFAULT_DATASET);
  const errors = issues.filter((i) => i.severity === 'error');
  console.log(`API listening on http://localhost:${PORT}${PRODUCTION ? ' (production)' : ''}`);
  console.log(`Dataset "${dataset.meta.datasetId}" v${dataset.meta.datasetVersion} — ${dataset.meta.provenance.status.toUpperCase()}`);
  if (errors.length) {
    console.warn(`  ${errors.length} data error(s). Run "npm run data:validate".`);
  }
  console.warn(`  ${dataset.meta.provenance.headline}`);
  if (PRODUCTION && !reloadEnabled) {
    console.log('  Reload endpoint is disabled (no RELOAD_TOKEN set).');
  }
});

/**
 * Container platforms send SIGTERM and then kill after a grace period. Closing
 * the listener lets in-flight requests finish and stops new connections being
 * accepted, which is the difference between a clean deploy and a handful of
 * truncated responses on every release.
 */
let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, finishing in-flight requests...`);
    server.close(() => process.exit(0));
    // If a synchronous search is mid-flight the loop cannot run the callback
    // promptly; do not hang past the platform's grace period.
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
