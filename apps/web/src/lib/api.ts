import type {
  BuildBody,
  BuildEvaluation,
  Dataset,
  OptimizeRequest,
  OptimizeResult,
} from '@2k27/core';
import type { CoverageReport, CrossCheckReport, ParseNote } from '@2k27/core';

const BASE = (import.meta.env['VITE_API_BASE'] as string | undefined) ?? '/api';

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

export function fetchDataset(id: string): Promise<DatasetPayload> {
  return request<DatasetPayload>(`/datasets/${id}`);
}

export function reloadDataset(id: string): Promise<{ reloaded: boolean; errors: DataIssue[]; warnings: DataIssue[] }> {
  return request(`/datasets/${id}/reload`, { method: 'POST' });
}

export function runOptimize(id: string, body: OptimizeRequest): Promise<OptimizeResult> {
  return request<OptimizeResult>(`/datasets/${id}/optimize`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function runArchetype(
  id: string,
  archetypeId: string,
  overrides: Partial<OptimizeRequest> & { body?: Partial<BuildBody> }
): Promise<{ request: OptimizeRequest; result: OptimizeResult }> {
  return request(`/datasets/${id}/archetype/${archetypeId}/optimize`, {
    method: 'POST',
    body: JSON.stringify(overrides),
  });
}

export function describeBuild(
  id: string,
  text: string,
  resultCount = 3,
  tokenOverrides?: Record<string, number | null>
): Promise<DescribeResponse> {
  return request<DescribeResponse>(`/datasets/${id}/describe`, {
    method: 'POST',
    body: JSON.stringify({ text, resultCount, tokenOverrides }),
  });
}

export function evaluateRemote(
  id: string,
  payload: { body: BuildBody; attributes: Record<string, number>; priorities?: Record<string, number> }
): Promise<BuildEvaluation> {
  return request<BuildEvaluation>(`/datasets/${id}/evaluate`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
