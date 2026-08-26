# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build stage. Needs dev dependencies (TypeScript, Vite) which the runtime does
# not, so the compiled output is copied into a clean image below.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

ENV NODE_ENV=development

# Manifests first: these change far less often than source, so the install layer
# stays cached across ordinary code edits.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY data ./data
COPY scripts ./scripts

# The dataset is the product. A malformed file must fail the build rather than
# ship an app that silently optimizes against nonsense.
RUN npm run data:validate \
 && npm run data:crosscheck \
 && npm run typecheck \
 && npm run test \
 && npm run build

# ---------------------------------------------------------------------------
# Runtime stage.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev && npm cache clean --force

# Compiled output only. Sources, tests and tooling stay out of the image.
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist

# The dataset is read at runtime, not bundled: findDataRoot() walks up for a
# `data/` directory, and the layout below is what it expects.
COPY --from=build /app/data ./data

# node:* images ship a non-root `node` user. Running as root in a container that
# serves the public internet buys nothing.
USER node

EXPOSE 8080

# Compose and plain `docker run` have no health probe of their own; managed
# platforms will use their own and ignore this.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form, so the process is PID 1 and receives SIGTERM directly — the server
# closes its listener on that signal to finish in-flight requests.
CMD ["node", "apps/api/dist/server.js"]
