# editorial-motion

Turn a static editorial image into a short documentary-style motion scene from one natural-language prompt.

## What this project does

`editorial-motion` is designed for editorial collages, maps, diagrams, infographics, financial graphics, and visual explainers. Its V1 pipeline is:

```text
image + motion prompt
        ↓
semantic analysis
        ↓
smart layer extraction
        ↓
background reconstruction
        ↓
validated Motion DSL
        ↓
deterministic Remotion render
        ↓
scene01.mp4
```

The system is intentionally not a general-purpose After Effects replacement. The V1 product boundary is one image, one prompt, and one MP4 output.

Default output:

- 2560×1440
- 30 fps
- H.264 MP4
- 8 seconds minimum
- Static camera by default
- Editorial-documentary motion style

See [SPEC-editorial-motion-v1.md](SPEC-editorial-motion-v1.md) for the complete product and architecture specification.

## Current status

The repository currently contains the local monorepo skeleton and contribution tooling. The application pipeline is being implemented milestone by milestone.

Available now:

- pnpm workspace and Turborepo configuration
- Reserved apps for web, API, renderer, and vision service
- Shared package layout
- Environment variable template
- Local pre-commit and pre-push quality gates
- Remotion hello-world composition under `apps/renderer`

Not available yet:

- End-to-end image rendering
- Web upload screen
- API job orchestration
- Vision models
- Full Motion DSL scene renderer
- Docker Compose services
- Configured Grounding DINO/SAM2 model providers

Follow the open [GitHub Issues](https://github.com/agnaldom/editorial-motion/issues) for implementation progress.

## Architecture

The planned V1 architecture is a monorepo with these applications:

- `apps/web`: upload and one-click generation UI
- `apps/api`: render job API and orchestration
- `apps/renderer`: deterministic Remotion composition and MP4 rendering
- `apps/vision-service`: Python service for detection, segmentation, inpainting, and route processing

Shared contracts and engines live under `packages/`. PostgreSQL stores jobs and artifact metadata. Redis backs the asynchronous job queue. Local files are used for development storage before an S3-compatible provider is introduced.

The LLM is only a motion planner. It returns validated Motion DSL JSON; it never generates executable React or Remotion code.

## Prerequisites

Install these tools before bootstrapping the project:

- Node.js 20 or newer
- pnpm 10 or newer
- Python 3.10 or newer for the vision service
- Docker and Docker Compose for PostgreSQL and Redis
- Git

## Local setup

Clone the repository and enter the project directory:

```bash
git clone https://github.com/agnaldom/editorial-motion.git
cd editorial-motion
```

Install the repository hooks:

```bash
./scripts/install-hooks.sh
```

Create local configuration:

```bash
cp .env.example .env
```

Install JavaScript dependencies:

```bash
pnpm install
```

The current repository does not yet include the full API pipeline or Docker Compose definitions. The renderer can be previewed after dependencies are installed.

The vision-service contract is now available under `apps/vision-service`. Its development provider intentionally returns no detections until a real model provider is configured.

Preview the renderer:

```bash
pnpm --filter @editorial-motion/renderer dev
```

Render the smoke-test MP4 locally:

```bash
pnpm --filter @editorial-motion/renderer exec tsx src/render.ts
```

The output is written to `apps/renderer/out/scene01.mp4` and is intentionally ignored by Git.

## How to use the application

Once the V1 pipeline is implemented:

1. Start PostgreSQL, Redis, the API, the vision service, the renderer, and the web app locally.
2. Open the local web URL.
3. Upload one PNG, JPEG, or WebP image.
4. Enter a motion prompt, for example:

   ```text
   Static camera. Drop the three country silhouettes into place sequentially,
   then draw outward capital routes from each. Lock routes and leave the
   three numerical zones empty for later typography.
   ```

5. Keep the default duration of 8 seconds or choose a longer duration.
6. Click **Generate animation**.
7. Follow the stage progress: analysis, detection, segmentation, layer extraction, background cleanup, motion planning, and rendering.
8. Preview or download `scene01.mp4`.

The API contract will be exposed under `/api/v1`, including render creation, job status, output download, and a protected debug analysis endpoint.

## Local quality gates

Install the hooks once per clone:

```bash
./scripts/install-hooks.sh
```

Run the full available gate manually:

```bash
./scripts/quality-gate.sh full
```

The hooks check for:

- accidentally staged secrets and private keys
- generated render artifacts and local data
- JavaScript/TypeScript lint, typecheck, and tests when configured
- Python tests or compilation checks when the vision service exists

There is no deployment workflow yet. All development and validation run locally.

## Contribution workflow

Every correction, improvement, or new feature must be traceable in GitHub:

1. Create or identify an Issue with scope and acceptance criteria.
2. Create a new branch from `main`, preferably `codex/<issue>-<slug>`.
3. Implement and validate locally.
4. Open a PR linked with `Closes #N` or `Refs #N`.
5. Include validation commands, results, risks, and reversal instructions.
6. Merge only after review and passing checks.
7. Update the Issue with the final result and follow-ups.

PRs must use the repository template. Changes to the architectural decisions in SPEC section 40 require an ADR under `docs/adr/`.

## Project layout

```text
apps/       web, api, renderer, vision-service
packages/   schemas, motion engine, render engine, shared config
infra/      Docker and local infrastructure
tests/      fixtures, integration tests, end-to-end tests
docs/       architecture and ADRs
```

## License

The project license will be added before the first public release.
