# Architecture — editorial-motion V1

How a still image plus a natural-language prompt becomes an editorial-documentary
MP4. Every statement below is grounded in the current code; where the code is a
V1 placeholder or the SPEC describes a target not yet implemented, this is
stated explicitly.

## Overview

```text
POST /api/v1/renders (image + prompt)
        │
        ▼
┌─────────────────────────────────────────────┐
│ API orchestrator (apps/api, Fastify + tsx)  │
│ sequential in-process pipeline              │
└──────────┬──────────────────────────────────┘
           │
           ▼
┌──────────────────────┐     ┌──────────────────────┐
│ Scene analysis +     │     │ Motion planning      │
│ motion planning      │     │ (LLM or deterministic│
│ (LLM or deterministic│     │ double)              │
│ doubles)             │     └──────────┬───────────┘
└──────────┬───────────┘                │
           │                            │
           ▼                            ▼
   artifacts under jobs/{jobId}/ in local storage
           │
           ▼
┌─────────────────────────────────────────────┐
│ Renderer (apps/renderer, Remotion +         │
│ headless Chromium), spawned as subprocess   │
│ `tsx src/render.ts --input render-input.json`│
└──────────┬──────────────────────────────────┘
           │
           ▼
   jobs/{jobId}/output/scene01.mp4  →  GET /api/v1/renders/:jobId/output
```

V1 is single-machine: one API process, one sequential worker, local filesystem
storage, in-memory job metadata. There is no deployment step; release is a
merge into `main` (see `docs/v1-acceptance.md`).

## Services

| Service | Location | Stack | V1 state |
|---|---|---|---|
| Web client | `apps/web` | Next.js / React (SPEC §7.1) | Placeholder — not implemented on this branch |
| API orchestrator | `apps/api` | Node.js, Fastify, TypeScript strict, Zod | Implemented (`src/server.ts`, `src/stages.ts`) |
| Renderer | `apps/renderer` | Remotion (`@remotion/bundler`, `@remotion/renderer`), headless Chromium | Implemented (`src/render.ts`, `src/EditorialScene.tsx`) |
| Vision service | `apps/vision-service` | Python 3.10+, FastAPI (SPEC §7.3) | Skeleton with provider interfaces; API currently uses deterministic in-process doubles |

The API never renders in-process. `RemotionCliRenderService`
(`apps/api/src/stages.ts:26`) spawns `apps/renderer/node_modules/.bin/tsx
src/render.ts --input <render-input.json> --output <mp4>` with
`cwd: apps/renderer`, captures stderr, and kills the child on timeout
(default 600 000 ms, overridable via `RENDER_TIMEOUT_MS`).

## HTTP API

Implemented in `apps/api/src/server.ts`. Base path `/api/v1`. Upload limit
25 MB; request timeout 120 s.

| Endpoint | Method | Behavior |
|---|---|---|
| `/api/v1/renders` | POST, multipart | Fields: `prompt` (required, ≤ 4000 chars), `durationSeconds` (8–20, default 8), `width`/`height` (default 2560×1440, max 3840×2160), `fps` (default 30, max 60), `outputFileName` (default `scene01.mp4`); one image part, PNG/JPEG/WebP only. Validates, stores the original under `jobs/{jobId}/input/`, enqueues, returns `202` with `jobId`. Errors: `400 INVALID_INPUT`. |
| `/api/v1/renders/:jobId` | GET | Job status: `jobId`, `status`, `stage`, `progress`, `output` (null until done), `error`. `404 NOT_FOUND` for unknown jobs. |
| `/api/v1/renders/:jobId/output` | GET | Streams the MP4 (`content-type: video/mp4`, content-disposition attachment). `404` until the output artifact exists. |
| `/api/v1/renders/:jobId/analysis` | GET | Debug payload: scene analysis, motion plan, artifact keys. Disabled when `DEBUG_ENDPOINTS=false`; gated on this env var because it exposes internals. |

Job lifecycle: `status` is one of `queued | processing | completed | failed`;
`stage` is the fine-grained pipeline stage (below); `progress` is derived from
stage index; failures carry `error: {code, message, retryable}`.

## Pipeline stages

Declared in `apps/api/src/jobs.ts` (`jobStages`) and executed by
`processJob` (`apps/api/src/stages.ts:251`) through `runPipeline`
(`apps/api/src/pipeline.ts`). Stages run strictly in order; `advanceJob`
rejects backward transitions, and a job in a terminal state cannot advance.

| Stage | Handler (`buildStageHandlers`) | Produces |
|---|---|---|
| `queued` | — (queue state) | job record |
| `validating` | re-validates image bytes | — |
| `normalizing` | reads pixel dimensions from the image header | `artifacts.dims` |
| `analyzing` | `analyzeScene` via a `SemanticVisionProvider` (LLM or deterministic double); stamps `source` dimensions/aspect ratio | `analysis/scene-analysis.json` |
| `detecting` | derives detections from analysis elements | `analysis/detections.json` |
| `segmenting` | writes one mask PNG per animatable element | `masks/{elementId}.png` |
| `extracting_layers` | builds layer descriptors (placement from normalized bbox, anchor 0.5/0.5, `zIndex`), links `maskRef`/`layerRef` back into the analysis | `layers/{elementId}.png`, `layers/layers.json` |
| `inpainting` | reconstructs background behind moving layers | `background/background-clean.png` |
| `planning_motion` | `createMotionPlan` via a `MotionPlannerProvider`; persisted plan | `motion/motion-plan.json` |
| `validating_plan` | `motionPlanSchema.parse` + `validateMotionPlan(plan, analysis)`; throws `MOTION_PLAN_INVALID` on errors | — |
| `rendering` | writes `render-input.json` (`plan`, background path, layers with placement) and calls `RenderService.render` | `output/{fileName}` |
| `verifying_output` | non-empty file check; `ffprobe` when available: width/height exact, fps ±1, duration ±0.5 s; writes probe result | `output/probe.json` |
| `completed` / `failed` | terminal | `completedAt`, `error` |

Retry: failure inside `analyzing`, `detecting`, `segmenting`, `inpainting`,
`planning_motion`, or `rendering` is marked retryable (`retryJob` increments
`attempt`); deterministic validation failures are not retried, per SPEC §26.

V1 placeholders, deliberately simple (marked with `ponytail:` comments where
applicable):

- `segmenting` writes a full-frame solid mask (`solidMaskPng`), not a model
  segmentation.
- `extracting_layers` stores the original image as every layer asset.
- `inpainting` stores a copy of the original image as `background-clean.png`.
- `planning_motion` hardcodes `allowedMotionTypes: ['fade_in', 'drop']`.
- Real detection/segmentation/inpainting models live behind provider
  interfaces in `apps/vision-service` (ADR-0002, ADR-0005) but are not wired
  into the API path yet.

## Contracts

Both contracts are strict Zod schemas in workspace packages; the planner emits
JSON only, and deterministic components interpret it (ADR-0001). Geometry is
normalized 0..1 everywhere (ADR-0003).

### SceneAnalysis (`packages/scene-schema`)

- `version: '1'`, `sceneId`, `source: {width, height, aspectRatio}`.
- `compositionType`: `editorial-collage | map | diagram | infographic | photo | mixed`.
- `elements` (max 10): `id`, `label`, `type` (`cutout`, `map_region`, `route`,
  `arrow`, `icon`, `photo`, `document`, `chart`, `text`, `stat_box`,
  `background`, `decorative`), `bbox` (normalized rect), `confidence` (0..1),
  `zIndex`, `animatable`, `protected`, `motionRole`
  (`primary | secondary | connector | static | protected`), `source`
  (`vision | detector | derived`), optional `maskRef`, `layerRef`,
  `relationshipIds`.
- `protectedRegions`: `{id, label, bbox, reason}` — text, numerical zones, and
  logos default to protected (SPEC §20).

### MotionPlan (`packages/motion-schema`)

- `version: '1'`, `sceneId`, `stylePreset: 'editorial-documentary'` (literal —
  no other preset exists).
- `durationSeconds` (min 8), `fps`, `canvas: {width, height}`.
- `camera`: `static | subtle_zoom_in | subtle_zoom_out | subtle_pan`, optional
  `start`/`duration` and `params` (`scaleFrom/scaleTo`, `xFrom/xTo`,
  `yFrom/yTo`).
- `events`: `{id, type, targetId, start, duration, easing?, persist?, params?}`
  with 18 event types (`fade_in`, `slide_*`, `drop`, `scale_in`, `wipe_reveal`,
  `mask_reveal`, `assemble`, `draw_path`, `draw_arrow`, `highlight`,
  `circle_emphasis`, `underline`, `shift`, `separate_layers`, `hold`, …) and
  easing `linear | editorialOut | editorialInOut`.
- `finalHold: {start, duration}` — the last segment of the plan is a static
  hold (SPEC §5.3).

`validateMotionPlan` (`packages/motion-engine`) enforces before rendering:
no events on protected elements or unknown targets, events fit inside
`durationSeconds`, camera scale delta ≤ 6 %, camera pan ≤ 5 %, and warns when
the final hold is under 1.5 s. The renderer (`SceneLayer`,
`CameraTransform`) plus `resolveLayerState` implement only a subset of event
types — see `docs/motion-style.md` for what is engine-supported vs.
style-level.

## Storage and metadata

- Driver: `LocalStorageDriver` (`apps/api/src/storage.ts`) — local filesystem
  under `LOCAL_STORAGE_PATH` (default `./data`), with strict key validation
  (`safeJoin`) to prevent path escape. Production target is S3-compatible
  object storage (SPEC §7.6); the `StorageDriver` interface is the seam.
- Object keys (match SPEC §7.6):

  ```text
  jobs/{jobId}/input/original.png
  jobs/{jobId}/analysis/scene-analysis.json
  jobs/{jobId}/analysis/detections.json
  jobs/{jobId}/masks/{elementId}.png
  jobs/{jobId}/layers/{elementId}.png
  jobs/{jobId}/layers/layers.json
  jobs/{jobId}/background/background-clean.png
  jobs/{jobId}/motion/motion-plan.json
  jobs/{jobId}/render-input.json
  jobs/{jobId}/output/{fileName}
  jobs/{jobId}/output/probe.json
  ```

- Metadata: `MemoryJobRepository` — in-process `Map`, lost on restart. SPEC
  §7.7 targets PostgreSQL with a database-agnostic repository interface;
  `LocalJobQueue` is a one-worker in-process sequential queue (SPEC §26),
  with BullMQ + Redis planned when the Docker infra lands (issue #71).

## Running locally

Prereqs: Node.js + pnpm, FFmpeg (`ffprobe` used for output verification;
without it only the non-empty check runs).

```bash
pnpm install

# Reference render without the API (deterministic sample scene):
pnpm --filter @editorial-motion/renderer exec tsx src/render.ts
./scripts/acceptance-check.sh apps/renderer/out/scene01.mp4

# API server (port 3000, or $PORT):
pnpm --filter @editorial-motion/api dev

# Quality gates (typecheck, lint, tests):
./scripts/quality-gate.sh
```

The acceptance check requires an 8-second MP4 at 2560×1440, 30 fps, H.264
(`docs/v1-acceptance.md`).

## Environment variables

Read by code today: `PORT`, `LOCAL_STORAGE_PATH`, `DEBUG_ENDPOINTS`,
`RENDER_TIMEOUT_MS`, `NODE_ENV`. Templates for the provider-facing variables
(LLM gateway, vision providers, render defaults) live in `.env.example`;
SPEC §35 lists the full production set (`DATABASE_URL`, `REDIS_URL`,
`VISION_SERVICE_URL`, `MOTION_LLM_*`, `INPAINT_PROVIDER`, `RENDER_*`). No
provider secret may be committed.

## Target deployment model (not yet implemented)

SPEC §34 defines the target `docker-compose.yml` topology — `web`, `api`,
`redis`, `postgres`, `vision-service` (GPU optional), `renderer` — with the
option to run web/API/renderer on the host while Redis/Postgres and the GPU
vision service run in Docker. On this branch `infra/compose/` and
`infra/docker/` are empty (`.gitkeep` only); nothing here describes running
infrastructure, only the SPEC target. Queue split into `vision-gpu` /
`inpainting-gpu` / `render-cpu` is explicitly post-V1 (SPEC §26).

## Architecture Decision Records

| ADR | Decision |
|---|---|
| [0001](adr/0001-motion-dsl-instead-of-generated-react.md) | Motion DSL instead of generated React — LLM outputs strict JSON only |
| [0002](adr/0002-python-vision-service.md) | Vision processing isolated in a Python service behind provider interfaces |
| [0003](adr/0003-normalized-coordinate-system.md) | Geometry stored in normalized coordinates (0..1) |
| [0004](adr/0004-editorial-documentary-motion-preset.md) | Editorial-documentary motion preset as the default style |
| [0005](adr/0005-background-inpainting-strategy.md) | Background reconstruction behind an `Inpainter` provider interface |

Per SPEC §40, these decisions must not change without a new ADR.
