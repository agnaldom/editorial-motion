FROM node:22-bookworm-slim AS base
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
RUN pnpm fetch

FROM base AS build
# ponytail: o Next faz bake das rewrites no `next build` (routes-manifest.json),
# então API_URL precisa existir no build — o ENV de runtime não afeta o rewrite.
ARG API_URL=http://api:3000
ENV API_URL=$API_URL
COPY apps/web ./apps/web
RUN pnpm install --offline --frozen-lockfile
RUN pnpm --filter @editorial-motion/web build

FROM node:22-bookworm-slim AS runner
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/web ./apps/web
ENV NODE_ENV=production
EXPOSE 3001
WORKDIR /repo/apps/web
CMD ["./node_modules/.bin/next", "start", "-p", "3001"]
