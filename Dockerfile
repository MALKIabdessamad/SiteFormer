# syntax=docker/dockerfile:1

# --- Build: install everything, compile the client and server bundles ---
FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

COPY . .

# VITE_* values are baked into the browser bundle at build time. Railway passes
# service variables as build args when they are declared here. Both are optional:
# the app falls back to the SiteFormer project in src/lib/config.ts.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
RUN bun run build

# --- Production dependencies only ---
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile --production

# --- Runtime ---
FROM oven/bun:1-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json server.ts ./

# Run as the unprivileged user that ships with the Bun image.
USER bun

# Railway sets PORT at runtime; server.ts reads it. EXPOSE is documentation only.
EXPOSE 3000
CMD ["bun", "run", "server.ts"]
