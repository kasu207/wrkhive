# Base images. Override with --build-arg (e.g. to use a registry mirror).
# The full image ships python3/make/g++, needed if better-sqlite3 has to be
# compiled for the platform; the runtime uses the slim variant.
ARG NODE_BUILD_IMAGE=node:22-bookworm
ARG NODE_IMAGE=node:22-bookworm-slim

# ---- 1. Dependencies ------------------------------------------------------------
FROM ${NODE_BUILD_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- 2. Build ----------------------------------------------------------------
FROM ${NODE_BUILD_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- 3. Runtime --------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_PATH=/data/wrkhive.db

RUN groupadd --system --gid 1001 wrkhive \
 && useradd --system --uid 1001 --gid wrkhive --home /app wrkhive \
 && mkdir -p /data \
 && chown wrkhive:wrkhive /data

# Standalone server with only the required node_modules, plus static assets
# and database migrations (applied automatically on start).
COPY --from=build --chown=wrkhive:wrkhive /app/.next/standalone ./
COPY --from=build --chown=wrkhive:wrkhive /app/.next/static ./.next/static
COPY --from=build --chown=wrkhive:wrkhive /app/drizzle ./drizzle

USER wrkhive
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
