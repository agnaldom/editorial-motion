# Multi-stage: base (manifests + deps) -> renderer (Chromium + renderer) -> api.
# A API renderiza via RemotionCliRenderService, que executa tsx src/render.ts
# dentro de apps/renderer (SPEC §7.5: Chromium runtime necessário) — por isso a
# imagem da API embute o renderer, e o target `renderer` serve o serviço
# utilitário de mesmo nome no compose.
FROM node:22-bookworm-slim AS base
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/renderer/package.json apps/renderer/
COPY packages/motion-engine/package.json packages/motion-engine/
COPY packages/motion-schema/package.json packages/motion-schema/
COPY packages/scene-schema/package.json packages/scene-schema/
RUN pnpm fetch

FROM base AS renderer
# Dependências do headless Chromium usado pelo @remotion/renderer (remotion/docs/linux).
RUN apt-get update && apt-get install -y --no-install-recommends \
      libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
      libasound2 libpango-1.0-0 libcairo2 \
    && rm -rf /var/lib/apt/lists/*
COPY apps/renderer ./apps/renderer
COPY packages ./packages
RUN pnpm install --offline --frozen-lockfile
WORKDIR /repo/apps/renderer
CMD ["pnpm", "exec", "tsx", "src/render.ts"]

FROM renderer AS api
WORKDIR /repo
COPY apps/api ./apps/api
RUN pnpm install --offline --frozen-lockfile
ENV PORT=3000
EXPOSE 3000
WORKDIR /repo/apps/api
CMD ["pnpm", "exec", "tsx", "src/server.ts"]
