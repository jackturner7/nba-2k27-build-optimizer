import type {
  BuildBody,
  BuildEvaluation,
  Dataset,
  OptimizeRequest,
  OptimizeResult,
} from '@2k27/core';
import type { CoverageReport, CrossCheckReport, ParseNote } from '@2k27/core';

const BASE = (import.meta.env['VITE_API_BASE'] as string | undefined) ?? '/api';

/**
 * Static builds run the engine in the browser instead of calling an API.
 *
 * The engine's public entry has no node builtins, so both modes execute exactly
 * the same code — the only difference is where. Set VITE_STATIC=1 to build a
 * site that needs no server at all; leave it unset for the API deployment.
 */
export const STATIC_MODE = import.meta.env['VITE_STATIC'] === '1';

export interface DataIssue {
  severity: 'error' | 'warning';
  file: string;
  message: string;
}

export interface VerificationReport {
  totalRecords: number;
  byStatus: Record<string, number>;
  unverifiedShare: number;
  byFile: { file: string; total: number; unverified: number }[];
}

export interface DatasetPayload {
  dataset: Dataset;
  issues: DataIssue[];
  verification: VerificationReport;
  coverage: CoverageReport;
  crossChecks: CrossCheckReport[];
}

export interface DescribeResponse {
  parsed: { notes: ParseNote[]; unparsed: string[]; bodyInferred: boolean };
  request: OptimizeRequest;
  result: OptimizeResult;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.error ?? detail;
    } catch {
      /* keep statusText */
    }
    throw new Error(`${res.status} ${detail}`);
  }
  return (await res.json()) as T;
}

export async function fetchDataset(id: string): Promise<DatasetPayload> {
  if (STATIC_MODE) {
    const { loadDatasetPayload } = await import('./dataset.browser');
    return loadDatasetPayload();
  }
  return request<DatasetPayload>(`/datasets/${id}`);
}

export function reloadDataset(id: string): Promise<{ reloaded: boolean; errors: DataIssue[]; warnings: DataIssue[] }> {
  return request(`/datasets/${id}/reload`, { method: 'POST' });
}

export interface HealthReport {
  ok: boolean;
  /** False in production unless a RELOAD_TOKEN is configured server-side. */
  reloadEnabled: boolean;
  load: { pending: number; peakPending: number; admittedTotal: number; shedTotal: number; eventLoopLagMs: number };
}

export function fetchHealth(): Promise<HealthReport> {
  // Nothing to reload in a static build: the dataset is compiled into the
  // bundle, so changing it means rebuilding rather than re-reading from disk.
  if (STATIC_MODE) {
    return Promise.resolve({
      ok: true,
      reloadEnabled: false,
      load: { pending: 0, peakPending: 0, admittedTotal: 0, shedTotal: 0, eventLoopLagMs: 0 },
    });
  }
  return request('/health');
}

export async function runOptimize(id: string, body: OptimizeRequest): Promise<OptimizeResult> {
  if (STATIC_MODE) {
    const { callWorker } = await import('./local');
    return callWorker<OptimizeResult>({ kind: 'optimize', request: body });
  }
  return request<OptimizeResult>(`/datasets/${id}/optimize`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function runArchetype(
  id: string,
  archetypeId: string,
  overrides: Partial<OptimizeRequest> & { body?: Partial<BuildBody> }
): Promise<{ request: OptimizeRequest; result: OptimizeResult }> {
  if (STATIC_MODE) {
    const { callWorker } = await import('./local');
    return callWorker({ kind: 'archetype', archetypeId, overrides });
  }
  return request(`/datasets/${id}/archetype/${archetypeId}/optimize`, {
    method: 'POST',
    body: JSON.stringify(overrides),
  });
}

export async function describeBuild(
  id: string,
  text: string,
  resultCount = 3,
  tokenOverrides?: Record<string, number | null>
): Promise<DescribeResponse> {
  if (STATIC_MODE) {
    const { callWorker } = await import('./local');
    return callWorker<DescribeResponse>({ kind: 'describe', text, resultCount, tokenOverrides });
  }
  return request<DescribeResponse>(`/datasets/${id}/describe`, {
    method: 'POST',
    body: JSON.stringify({ text, resultCount, tokenOverrides }),
  });
}

export async function evaluateRemote(
  id: string,
  payload: { body: BuildBody; attributes: Record<string, number>; priorities?: Record<string, number> }
): Promise<BuildEvaluation> {
  if (STATIC_MODE) {
    const { callWorker } = await import('./local');
    return callWorker<BuildEvaluation>({ kind: 'evaluate', payload });
  }
  return request<BuildEvaluation>(`/datasets/${id}/evaluate`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
