# Kiran DMS — Railway deployment.
#
# Deployable unit: apps/web (Next.js 16, workspace package "@kiran/web").
# Railway detects this Dockerfile at the repo root and builds it; the runner
# starts `pnpm --filter @kiran/web start`, and Next.js honours the injected PORT.
#
# Stack: Node 22 (repo "engines": { "node": ">=22" }), pnpm 10.33.4 via corepack.
# Local equivalent: pnpm --filter @kiran/web build  &&  pnpm --filter @kiran/web start

# syntax=docker/dockerfile:1
FROM node:22-slim AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm/bin:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate

# Every workspace manifest must exist before the frozen install. With only the root
# manifest, pnpm installs no workspace package and the app build dies with
# "cross-env: not found" (the 2026-11-21 build failures).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY packages/import/package.json ./packages/import/
RUN pnpm install --frozen-lockfile

FROM base AS builder
ENV NODE_ENV=production
# NEXT_PUBLIC_* are inlined into the client bundle at build time. Railway passes the
# service variables to the build as build arguments; ARG is what receives them, so a
# build without these two produces a bundle that believes Supabase is unconfigured.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
COPY . .
RUN pnpm --filter @kiran/web run build

# Runner starts from the same base so pnpm and the installed workspace
# node_modules are present (a bare node:22-slim has neither, and the start
# command would not resolve).
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
# The build output lives in the workspace package, not at the repo root.
COPY --from=builder /app/apps/web/.next ./apps/web/.next
EXPOSE 8080
# Next.js start honours PORT; Railway injects it at runtime.
CMD ["pnpm", "--filter", "@kiran/web", "start"]
