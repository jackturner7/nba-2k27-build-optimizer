/**
 * A bounded queue for the CPU-bound routes.
 *
 * The optimizer is synchronous: a search runs to completion without yielding.
 * That makes the usual tools useless. An in-flight counter never exceeds one,
 * because the handler never awaits. A request timeout is impossible, because
 * you cannot interrupt synchronous JavaScript. The only lever is refusing to
 * start work — which needs an accurate answer to "how many are already waiting".
 *
 * Event-loop lag does not answer it. Measured against 40 concurrent searches, a
 * windowed mean peaked at 197 ms, never crossed a 250 ms threshold, shed nothing
 * and let `/api/health` block for 4.3 seconds. Switching to the most recent
 * sample shed correctly but then refused 3 of 12 *sequential* requests, because
 * a stale high reading cannot distinguish "a search just finished" from "thirty
 * more are queued behind it".
 *
 * So this measures the queue instead of guessing at it. Admission is recorded
 * synchronously, then the work is deferred by one `setImmediate`. Node drains
 * ready sockets in the poll phase and runs `setImmediate` callbacks in the check
 * phase afterwards, so a burst of requests all pass through admission *before*
 * the first search begins, and `pending` is the real depth at decision time. A
 * client sending one request at a time always sees a depth of zero.
 */

let pending = 0;
let admittedTotal = 0;
let shedTotal = 0;
let peakPending = 0;

export interface QueueStats {
  pending: number;
  peakPending: number;
  admittedTotal: number;
  shedTotal: number;
}

export function queueStats(): QueueStats {
  return { pending, peakPending, admittedTotal, shedTotal };
}

/** Thrown by nothing — `runHeavy` signals refusal by resolving to this. */
export const SHED = Symbol('shed');

/**
 * Runs `work` off the current tick if the queue has room, otherwise refuses.
 *
 * Resolves to `SHED` when the queue is full. Refusing is deliberate: queueing
 * the request would slow every *other* request down rather than just its own,
 * and the client cannot tell the difference between slow and hung.
 */
export function runHeavy<T>(maxPending: number, work: () => T): Promise<T | typeof SHED> {
  if (pending >= maxPending) {
    shedTotal++;
    return Promise.resolve(SHED);
  }
  pending++;
  admittedTotal++;
  if (pending > peakPending) peakPending = pending;

  return new Promise<T | typeof SHED>((resolve, reject) => {
    setImmediate(() => {
      try {
        resolve(work());
      } catch (err) {
        reject(err as Error);
      } finally {
        pending--;
      }
    });
  });
}
