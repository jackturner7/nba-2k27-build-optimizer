# Deploying

The whole app is **one container**: an Express process that serves the JSON API
and the built React UI from the same port. There is no database, no cache, and
no external service — the dataset is JSON files baked into the image.

```bash
docker build -t 2k27-optimizer .
docker run -p 8080:8080 2k27-optimizer
# http://localhost:8080
```

That works unchanged on Fly, Render, Railway, Cloud Run, ECS, or a VPS with
Docker. `fly.toml` in the repo root is a working example for one of them; the
rest need nothing but the image and the environment variables below.

---

## What the build enforces

The Docker build runs `data:validate`, `data:crosscheck`, `typecheck`, `test`
and `build` before it will produce an image. That ordering is deliberate: **the
dataset is the product**, so a malformed cap table or an undocumented conflict
between two badge sources fails the build rather than shipping an app that
optimizes confidently against nonsense.

CI (`.github/workflows/ci.yml`) runs the same checks, then smoke-tests the
built server: health, the SPA index, and a real optimize call. It also builds
the image and curls it. A green unit-test run does not prove the thing you
deploy actually boots.

---

## Configuration

Everything is environment variables; none are required.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `8080` in the image, `4000` otherwise | Listen port. |
| `NODE_ENV` | — | Set to `production` to get generic 500s and gate the reload endpoint. |
| `DATA_ROOT` | auto-discovered | Absolute path to a directory containing `<datasetId>/meta.json`. Point this at a mounted volume to update the dataset without rebuilding. |
| `WEB_DIST` | next to the data root | Where the built UI lives. |
| `DATASET_ID` | `2k27` | Which dataset to report at startup. |
| `RELOAD_TOKEN` | unset | Enables `POST /api/datasets/:id/reload` in production, requiring this value in an `x-reload-token` header. Unset means the endpoint is off. |
| `RATE_LIMIT_GENERAL` | `300` | Requests per minute per IP across `/api`. |
| `RATE_LIMIT_OPTIMIZE` | `30` | Requests per minute per IP for the four search routes. |
| `MAX_QUEUE_DEPTH` | `4` | How many searches may be waiting before further ones are refused. |
| `TRUST_PROXY_HOPS` | `1` | Proxy hops to trust when deriving the client IP. |
| `CORS_ORIGIN` | `*` | Comma-separated allowlist. |

### `TRUST_PROXY_HOPS` matters more than it looks

Rate limiting is per-IP. Behind a load balancer, every request appears to come
from the balancer unless the app is told how many hops to trust, and the whole
internet shares one bucket. The default of `1` is right for every managed
platform that puts a single proxy in front of you. Set it higher only if you
have added your own proxy in front of theirs — setting it too high lets a client
forge `X-Forwarded-For` and evade the limit entirely.

---

## How the app protects itself

The optimizer is **synchronous CPU work**: a search is 100–400 ms during which
the process does nothing else. That single fact drives the whole design.

**Per-IP rate limiting** is the first line: 30 searches/minute, against 300 for
the cheap lookup endpoints the UI hits while you drag a slider.

**A bounded queue** is the second, and it is the one that matters under a burst.
Admission is recorded synchronously and the search deferred by one
`setImmediate`, so a burst of arrivals all pass through admission before the
first search starts and the pending count is the *real* queue depth. Past
`MAX_QUEUE_DEPTH` the server returns `503` with `Retry-After` instead of
queueing — because a queued request would slow every *other* request down
rather than just its own, and the client cannot tell slow from hung.

The alternative was measuring event-loop lag, and it was tried first. It does
not work here, in both directions:

| approach | 40 concurrent searches | 12 sequential searches |
| --- | --- | --- |
| windowed mean lag | shed **0**, `/api/health` blocked **4.3 s** | fine |
| most-recent-sample lag | shed correctly | refused **3 of 12** — false positives |
| bounded queue (shipped) | shed 35, health worst **435 ms** | **12/12 admitted** |

Lag cannot distinguish "a search just finished" from "thirty more are queued".
Queue depth can. Lag is still measured and reported on `/api/health`, because it
is the right number to look at when a deployed instance feels slow.

**There is no request timeout, and there cannot be one.** You cannot interrupt
synchronous JavaScript. Refusing to start work is the only lever, which is why
admission control carries the weight here.

### Scaling

One instance ≈ 3–6 searches/second on one core. The process is stateless, so
scaling is horizontal: add instances behind the load balancer. Raise
`MAX_QUEUE_DEPTH` only if you have given the container more than one core, and
even then the ceiling is one search at a time per process — Node runs your
JavaScript on a single thread regardless of how many cores the box has. Running
several instances beats giving one instance more CPU.

---

## Health checks

`GET /api/health` returns liveness plus the numbers that distinguish a saturated
instance from a broken one:

```json
{
  "ok": true,
  "reloadEnabled": false,
  "load": { "pending": 0, "peakPending": 4, "admittedTotal": 17, "shedTotal": 35, "eventLoopLagMs": 1 },
  "uptimeSeconds": 812
}
```

A rising `shedTotal` means you need more instances, not a restart. Give the
check a **timeout of at least 2 s**: an in-flight search can delay the response
by its own duration, and that is normal, not a fault.

The process handles `SIGTERM` by closing the listener so in-flight requests
finish, with a 10 s backstop. Give the platform a grace period of at least that.

---

## Updating the dataset without redeploying

Two options.

1. **Mount a volume** and point `DATA_ROOT` at it. Then `POST
   /api/datasets/2k27/reload` with the `x-reload-token` header re-reads from
   disk. The UI's *Reload data* button hides itself when the server reports the
   endpoint is off, so it never offers an action that will 404.
2. **Rebuild the image.** Simpler, and the dataset is only 272 KB — the whole
   image is ~23 MB of `node_modules` plus dist and data.

Reload is *disabled by default in production*. It re-reads from disk and drops
the cache, which is exactly what you want while editing JSON locally and exactly
what you do not want exposed anonymously on the internet.

---

## Before you make it public

One thing here is a judgement call rather than a task, and it is not mine to
make: **positioning**. "NBA 2K27" and "MyPLAYER" are 2K trademarks. This is an
unofficial fan tool that reads community data; it does not redistribute game
assets or code. Most such tools carry a visible disclaimer naming the trademark
owner and disclaiming affiliation. There is no such notice in the UI right now.
Decide whether you want one before the URL is public, not after.

The dataset banner already tells users which numbers are sourced and which are
invented, which is the other half of not misleading anyone.
