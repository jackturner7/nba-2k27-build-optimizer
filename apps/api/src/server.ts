import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
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

// ---------------------------------------------------------------------------
// Dataset cache. Datasets are reloaded on demand so you can edit a JSON file
// and hit /api/datasets/2k27/reload without restarting the server.
// ---------------------------------------------------------------------------

const cache = new Map<string, { dataset: Dataset; issues: ReturnType<typeof checkReferentialIntegrity> }>();

function getDataset(id: string) {
  let entry = cache.get(id);
  if (!entry) {
    const loaded = loadDatasetFromDisk(id);
    entry = { dataset: loaded.dataset, issues: loaded.issues };
    cache.set(id, entry);
  }
  return entry;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

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

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, datasets: listDatasets(), dataRoot: findDataRoot() });
});

/** Everything the client needs to render the builder, in one payload. */
app.get('/api/datasets/:id', (req, res) => {
  const { dataset, issues } = getDataset(req.params.id);
  res.json({
    dataset,
    issues,
    verification: verificationReport(dataset),
    coverage: datasetCoverage(dataset),
    crossChecks: loadSecondSources(req.params.id).map((source) => crossCheckBadges(dataset, source)),
  });
});

app.post('/api/datasets/:id/reload', (req, res) => {
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

app.post('/api/datasets/:id/optimize', (req, res) => {
  const { dataset } = getDataset(req.params.id);
  const parsed = optimizeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid optimize request', details: parsed.error.issues });
    return;
  }
  res.json(optimize(dataset, parsed.data));
});

app.post('/api/datasets/:id/evaluate', (req, res) => {
  const { dataset } = getDataset(req.params.id);
  const parsed = evaluateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid evaluate request', details: parsed.error.issues });
    return;
  }
  const body = validateBody(dataset, parsed.data.body).corrected;
  res.json(
    evaluateBuild(dataset, body, parsed.data.attributes, {
      priorities: parsed.data.priorities ?? {},
      minimums: parsed.data.minimums,
      softTargets: parsed.data.softTargets,
      useCapBreakers: parsed.data.useCapBreakers,
      useBadgeBoosts: parsed.data.useBadgeBoosts,
      tokenOverrides: parsed.data.tokenOverrides,
    })
  );
});

app.post('/api/datasets/:id/archetype/:archetypeId/optimize', (req, res) => {
  const { dataset } = getDataset(req.params.id);
  const overrides = req.body ?? {};
  try {
    const request = requestFromArchetype(dataset, req.params.archetypeId, overrides);
    res.json({ request, result: optimize(dataset, request) });
  } catch (e) {
    res.status(404).json({ error: (e as Error).message });
  }
});

/** Natural-language "Build Optimizer" mode. */
app.post('/api/datasets/:id/describe', (req, res) => {
  const { dataset } = getDataset(req.params.id);
  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  if (!text.trim()) {
    res.status(400).json({ error: 'Provide a "text" field describing the build you want.' });
    return;
  }
  const parsed = parseBuildRequest(dataset, text);
  const request = {
    ...parsed.request,
    resultCount: Number(req.body?.resultCount ?? 3),
    ...(req.body?.tokenOverrides ? { tokenOverrides: req.body.tokenOverrides } : {}),
  };
  res.json({
    parsed: { notes: parsed.notes, unparsed: parsed.unparsed, bodyInferred: parsed.bodyInferred },
    request,
    result: optimize(dataset, request),
  });
});

// ---------------------------------------------------------------------------
// Static hosting for the built web app, so `npm start` serves the whole thing.
// ---------------------------------------------------------------------------

const webDist = join(findDataRoot(), '..', 'apps', 'web', 'dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(join(webDist, 'index.html'));
  });
}

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  const { dataset, issues } = getDataset(DEFAULT_DATASET);
  const errors = issues.filter((i) => i.severity === 'error');
  console.log(`API listening on http://localhost:${PORT}`);
  console.log(`Dataset "${dataset.meta.datasetId}" v${dataset.meta.datasetVersion} — ${dataset.meta.provenance.status.toUpperCase()}`);
  if (errors.length) {
    console.warn(`  ${errors.length} data error(s). Run "npm run data:validate".`);
  }
  console.warn(`  ${dataset.meta.provenance.headline}`);
});
