import type { NextFunction, Request, Response } from 'express';

/**
 * Event-loop lag, sampled for reporting on `/api/health`.
 *
 * This is a diagnostic, NOT the admission signal — see `queue.ts` for why. Lag
 * cannot distinguish "a search just finished" from "thirty more are queued", so
 * basing admission on it either sheds nothing under load or sheds a sequential
 * client's perfectly reasonable requests. It is still the right number to look
 * at when a deployed instance feels slow, so it is measured and surfaced.
 */
const SAMPLE_INTERVAL_MS = 20;

let lastLagMs = 0;
let expected = Date.now() + SAMPLE_INTERVAL_MS;

const sampler = setInterval(() => {
  const now = Date.now();
  lastLagMs = Math.max(0, now - expected);
  expected = now + SAMPLE_INTERVAL_MS;
}, SAMPLE_INTERVAL_MS);
sampler.unref();

/** How late the most recent loop tick was, in ms. Near zero when idle. */
export function eventLoopLagMs(): number {
  // A tick that has not fired *yet* is itself evidence of a stall, so take the
  // worse of the last sample and how overdue the next one already is.
  return Math.max(lastLagMs, Math.max(0, Date.now() - expected));
}

/**
 * Security headers. This app serves a self-contained SPA and a read-only JSON
 * API, so the policy can be strict: no framing, no sniffing, no referrers, and
 * a CSP that allows only same-origin assets.
 *
 * Deliberately not `helmet`: that pulls in a dozen middlewares to set headers
 * this app can enumerate in ten lines, and several of its defaults (HSTS in
 * particular) are decisions for whoever terminates TLS, not for this process.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      // Vite inlines a small style block; scripts are all emitted as files.
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join('; ')
  );
  next();
}
