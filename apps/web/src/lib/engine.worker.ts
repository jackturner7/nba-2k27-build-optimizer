/// <reference lib="webworker" />
import { evaluateBuild, optimize, parseBuildRequest, requestFromArchetype, validateBody } from '@2k27/core';
import type { OptimizeRequest } from '@2k27/core';
import { loadDatasetPayload } from './dataset.browser';

/**
 * The optimizer, running in a Web Worker.
 *
 * A search is 100-400 ms of *synchronous* CPU. On the main thread that is a
 * frozen UI: no spinner animation, no cancel button, no scrolling. The exact
 * property that made this hard to defend server-side — synchronous work cannot
 * be interrupted or timed out — is why it belongs on its own thread here.
 *
 * The dataset is built once per worker, on first use.
 */

type Job =
  | { id: number; kind: 'optimize'; request: OptimizeRequest }
  | { id: number; kind: 'archetype'; archetypeId: string; overrides: Record<string, unknown> }
  | { id: number; kind: 'describe'; text: string; resultCount?: number; tokenOverrides?: Record<string, number | null> }
  | { id: number; kind: 'evaluate'; payload: Record<string, unknown> };

function dataset() {
  return loadDatasetPayload().dataset;
}

self.addEventListener('message', (event: MessageEvent<Job>) => {
  const job = event.data;
  try {
    self.postMessage({ id: job.id, ok: true, result: run(job) });
  } catch (err) {
    self.postMessage({ id: job.id, ok: false, error: (err as Error).message });
  }
});

function run(job: Job): unknown {
  const ds = dataset();
  switch (job.kind) {
    case 'optimize':
      return optimize(ds, job.request);

    case 'archetype': {
      const request = requestFromArchetype(ds, job.archetypeId, job.overrides);
      return { request, result: optimize(ds, request) };
    }

    case 'describe': {
      const parsed = parseBuildRequest(ds, job.text);
      const requested = Number(job.resultCount ?? 3);
      const request = {
        ...parsed.request,
        resultCount: Number.isFinite(requested) ? Math.min(6, Math.max(1, Math.round(requested))) : 3,
        ...(job.tokenOverrides ? { tokenOverrides: job.tokenOverrides } : {}),
      };
      return {
        parsed: { notes: parsed.notes, unparsed: parsed.unparsed, bodyInferred: parsed.bodyInferred },
        request,
        result: optimize(ds, request),
      };
    }

    case 'evaluate': {
      const p = job.payload as {
        body: Parameters<typeof validateBody>[1];
        attributes: Record<string, number>;
        priorities?: Record<string, number>;
        minimums?: Record<string, number>;
        softTargets?: Record<string, number>;
        useCapBreakers?: boolean;
        useBadgeBoosts?: boolean;
        tokenOverrides?: Record<string, number | null>;
      };
      const validated = validateBody(ds, p.body).corrected;
      return evaluateBuild(ds, validated, p.attributes, {
        priorities: p.priorities ?? {},
        minimums: p.minimums,
        softTargets: p.softTargets,
        useCapBreakers: p.useCapBreakers,
        useBadgeBoosts: p.useBadgeBoosts,
        tokenOverrides: p.tokenOverrides,
      });
    }
  }
}
