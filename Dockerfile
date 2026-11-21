# Kiran DMS — Railway deployment.
#
# Deployable unit: apps/web (Next.js 16, workspace package "@kiran/web").
# Railway builds the whole pnpmworkspace with `pnpm install --frozen-lockfile`
# and starts the filtered app (`pnpm --filter @kiran/web start`). Railway
# supplies the port via the PORT env var; Next.js start honours PORT.
#
# Stack: Node 22 (matches repo "engines": { "node": ">=22" }).
# Local equivalent: pnpm --filter @kiran/web build  &&  pnpm --filter @kiran/web start

# syntax=docker/dockerfile:1
FROM node:22-slim AS base
ENV NODE_ENV=production
WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm/bin:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate

# Copy workspace manifest so the lockfile resolves the whole pnpmworkspace.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=base /app /app
COPY . .
RUN pnpm --filter @kiran/web run build

FROM node:22-slim AS runner
ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app
COPY --from=base /app /app
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
EXPOSE 8080
# Next.js start serves on $PORT (set by Railway at runtime).
CMD ["pnpm", "--filter", "@kiran/web", "start"]
