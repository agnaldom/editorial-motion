# Docker (SPEC §34)

## Sem GPU (CPU apenas)

```bash
docker compose -f infra/compose/docker-compose.yml up --build
```

Serviços e portas:

| Serviço         | Porta  | O que roda |
|-----------------|--------|------------|
| `web`           | 3001   | Next.js (rewrite `/api/v1/*` → `api:3000`) |
| `api`           | 3000   | Fastify + pipeline (render embutido via RemotionCliRenderService) |
| `vision-service`| 8000   | FastAPI (`/health` para readiness) |
| `redis`         | 6379   | Reservado (BullMQ futuro — hoje `MemoryJobRepository`) |
| `postgres`      | 5432   | Reservado (metadata futuro — SPEC §7.7) |
| `renderer`      | —      | Container utilitário (Chromium) para dev/verificação isolada |

O fluxo completo fica em http://localhost:3001 (upload → prompt → progresso → download).

## Com GPU (vision-service acelerado)

Requer [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/)
e driver NVIDIA no host:

```bash
docker compose -f infra/compose/docker-compose.yml -f infra/compose/docker-compose.gpu.yml up --build
```

O override `docker-compose.gpu.yml` liga `INSTALL_ML=true` (torch, sam2,
simple-lama-inpainting etc. — ver `apps/vision-service/requirements-ml.txt`) e
reserva as GPUs via `deploy.resources.reservations.devices`.

## Modo misto (SPEC §34)

web/API/renderer podem rodar no host e só os serviços de apoio em Docker:

```bash
docker compose -f infra/compose/docker-compose.yml up redis postgres vision-service
pnpm dev   # web + api no host
```

## Notas

- **Renderer**: o pipeline renderiza dentro do container `api` (Chromium embutido
  na imagem, SPEC §7.5). O serviço `renderer` existe para desenvolvimento isolado:
  `docker compose exec renderer pnpm exec tsx src/render.ts --output /tmp/scene01.mp4`.
- **Persistência**: artefatos de job ficam no volume `api-data` (`/repo/data`).
- **Segredos**: LLM providers e afins via variáveis de ambiente no compose —
  nunca commitados (SPEC §35).
