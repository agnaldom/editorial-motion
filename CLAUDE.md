# CLAUDE.md

Guidelines for AI agents and contributors working on Editorial Motion. These rules complement the project README and apply to local development, code review, and pull requests.

## 1. Think Before Coding

Before changing code:

- Read the relevant Issue, SPEC, README, and nearby implementation.
- State assumptions when the request is ambiguous.
- Define a small, verifiable outcome before implementation.
- Prefer the smallest solution that satisfies the acceptance criteria.
- Do not invent external services, deployment steps, or product requirements.

For multi-step work, use this loop:

1. Identify the Issue and affected package.
2. Implement the smallest coherent change.
3. Add or update tests and documentation.
4. Run the quality gates and the relevant local workflow.
5. Create a branch and PR that references the Issue.

## 2. Project Context

Editorial Motion converts a still editorial image and a motion prompt into a restrained documentary-style motion composition. V1 is local-only and is designed around:

- a TypeScript API and job state machine;
- a Python vision service with provider contracts;
- strict scene and motion schemas;
- a Remotion renderer;
- deterministic motion validation and protected regions;
- local MP4 output and acceptance checks.

The current project does not deploy to production. Do not add deployment automation or cloud infrastructure unless a future Issue explicitly requests it.

Monorepo map (pnpm workspaces + turbo):

| Path | What |
|------|------|
| `apps/api` | Fastify orchestrator: HTTP API, sequential in-process pipeline, spawns the renderer |
| `apps/renderer` | Remotion composition + `render.ts` CLI entry; **CJS** (never `import.meta.url`; use `process.cwd()`) |
| `apps/web` | Next.js one-click UI (port 3001; rewrites `/api/v1/*` → `API_URL`) |
| `apps/vision-service` | Python/FastAPI vision microservice (CPU base; GPU via `INSTALL_ML` build arg) |
| `packages/motion-schema`, `packages/scene-schema` | Zod contracts (SceneAnalysis, MotionPlan) |
| `packages/motion-engine` | Motion plan validation + deterministic animation math |
| `packages/shared` | Cross-app utils (analysis cache keys) |
| `tests/fixtures` | Deterministic fixture scenes (`generate.mjs`, fixed seed) |
| `tests/integration` | Pipeline tests with real Remotion renders |
| `tests/e2e` | Playwright one-click flow |
| `infra/compose`, `infra/docker` | Docker services per SPEC §34 |

Gotchas: `apps/renderer` runs as CJS; `tests/` is ESM (`"type": "module"`); workspace
packages import via `@editorial-motion/*` (path-mapped in `tsconfig.base.json`).

## 3. Simplicity and Surgical Changes

- Touch only files required by the Issue.
- Match the existing style and package boundaries.
- Do not refactor unrelated code while implementing a feature.
- Do not add speculative abstractions, providers, configuration, or databases.
- Remove unused code introduced by your change, but do not clean up unrelated code.
- Keep provider integrations behind explicit interfaces and preserve deterministic development fallbacks.
- Deliberate shortcuts with a known ceiling (in-memory cache, coarse progress, placeholder providers) carry a `ponytail:` comment naming the ceiling and the upgrade path.

## 4. Source of Truth and Architecture

- `SPEC-editorial-motion-v1.md` defines the product scope and acceptance intent.
- `README.md` defines setup and user-facing workflows.
- `docs/architecture.md` documents the pipeline, HTTP API, contracts, and storage.
- `docs/motion-style.md` operationalizes the motion rules (engine rules vs. style directives).
- `docs/adr/` records architectural decisions; add an ADR for durable cross-cutting decisions.
- `apps/api` owns input validation, jobs, orchestration, and API behavior.
- `apps/renderer` owns Remotion compositions and video rendering.
- `apps/web` owns the one-click UI.
- `apps/vision-service` owns Python vision contracts and image-processing stages.
- `packages/*` contain reusable schemas, motion logic, and shared utilities.
- `tests/fixtures` contains the fixture catalog and fixture contract documentation.

When sources disagree, do not silently choose. Document the conflict in the PR and update the appropriate source of truth.

## 5. Issue, Branch, and Pull Request Workflow

Every non-trivial change must follow this workflow:

1. Select or create a GitHub Issue describing the correction, improvement, or new function.
2. Start from the latest `main` — or, when the change depends on an open PR, stack the branch on that PR's branch and set the PR base accordingly.
3. Create a new branch `feat/<issue>-<slug>` (for example `feat/73-analysis-cache`).
4. Make focused commits that reference the Issue when useful.
5. Run all quality gates locally, plus the user's scenario end-to-end for UI/pipeline changes.
6. Push the branch and open a PR against its base (`main` or the stacked-on branch).
7. Reference the Issue with `Refs #N`, `Fixes #N`, or the appropriate GitHub keyword, and close the Issue with a summary comment referencing the PR.
8. Do not merge or deploy unless the user explicitly requests that action.

One PR should represent one coherent unit of work. Include verification commands and known limitations in the PR description.

Never commit: `AGENTS.md`, `SPEC-editorial-motion-v1.md`, `graphify-out/` (untracked by design), `.env*`, keys, or media artifacts — `scripts/quality-gate.sh` enforces part of this on commit.

## 6. Quality Gates Are Mandatory

Never bypass hooks with `--no-verify`.

Before pushing, run:

```bash
pnpm lint
pnpm typecheck
pnpm test                      # unit tests + integration
pnpm test:integration          # real pipeline render (~20 s)
```

The repository hooks run these checks through `scripts/quality-gate.sh`. The GitHub workflow must remain a quality gate only; it must not deploy the project.

For Python changes, also run:

```bash
apps/vision-service/.venv/bin/python -m pytest apps/vision-service/tests -q
```

For renderer changes, validate the local output when applicable:

```bash
pnpm --filter @editorial-motion/renderer exec tsx src/render.ts
./scripts/acceptance-check.sh apps/renderer/out/scene01.mp4
pnpm --filter @editorial-motion/renderer smoke   # short render + ffprobe (~15 s)
```

For web changes, run the E2E flow (`pnpm --filter @editorial-motion/e2e test:e2e`)
when it exists on the branch. Docker smoke when touching `infra/`:
`docker compose -f infra/compose/docker-compose.yml config && ... build`.

If an environment issue blocks a check, report the exact command, error, and whether the check was retried with an appropriate local workaround. Do not claim a gate passed when it did not run.

## 7. Testing and Acceptance

- Turn bug reports into regression tests before or alongside the fix.
- Validate malformed input, protected regions, unknown targets, and invalid state transitions where relevant.
- Keep schemas strict and reject unknown fields unless the contract explicitly allows them.
- Preserve the V1 output contract: MP4, 2560×1440, 30 fps, approximately 8 seconds, H.264.
- Do not animate or regenerate protected numerical zones, labels, or typography.
- Use `docs/v1-acceptance.md` for the local release checklist and evidence.

## 8. Security and Data Handling

- Never commit secrets, API keys, credentials, user uploads, generated videos, or local environment files.
- Preserve upload size, MIME, filename, and prompt validation.
- Keep debug data local and non-public; do not expose internal provider traces through public API responses.
- Treat uploaded media as untrusted input.
- Never log raw user images or secrets; prompts are logged only when `LOG_PROMPTS=true` (SPEC §31).

## 9. Dependencies and Local Infrastructure

- Use the package manager declared in `package.json` (`pnpm@10.0.0`).
- Redis/Postgres exist in `infra/compose/docker-compose.yml` as **reserved** services (SPEC §34); the running code still uses in-memory repository/queue and local storage — do not wire infrastructure without an approved Issue.
- Keep dependency changes narrow and explain why they are needed in the PR.
- Do not modify lockfiles casually. If dependency installation changes a lockfile, review the diff before committing it.

## 10. Completion Standard

A task is complete only when:

- the requested behavior is implemented;
- relevant tests and documentation are updated;
- quality gates pass;
- the branch is pushed;
- the PR references the Issue and records verification;
- limitations and follow-up work are explicit.

For simple documentation-only changes, use judgment, but still preserve the branch and PR workflow when the change is intended for the repository.
