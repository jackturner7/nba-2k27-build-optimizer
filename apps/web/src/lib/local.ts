/**
 * Client for the in-browser engine, used when the app is built as a static site.
 *
 * The engine's public entry has no node builtins, so the same code the API runs
 * runs here — this is not a reduced or approximated version. What changes is
 * where it executes: a Web Worker instead of a server process.
 *
 * That removes the entire class of problem the server deployment has to defend
 * against. There is no shared CPU to saturate, so no rate limiting, no queue,
 * no load shedding: a slow search costs only the person who asked for it.
 */

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (event: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
    const entry = pending.get(event.data.id);
    if (!entry) return;
    pending.delete(event.data.id);
    if (event.data.ok) entry.resolve(event.data.result);
    else entry.reject(new Error(event.data.error ?? 'The optimizer failed.'));
  });
  worker.addEventListener('error', (event) => {
    // A worker-level failure kills every job in flight; surface it rather than
    // leaving callers hanging on promises that will never settle.
    const message = event.message || 'The optimizer worker crashed.';
    for (const [, entry] of pending) entry.reject(new Error(message));
    pending.clear();
    worker = null;
  });
  return worker;
}

export function callWorker<T>(job: Record<string, unknown>): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    getWorker().postMessage({ ...job, id });
  });
}
