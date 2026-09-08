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

## 3. Simplicity and Surgical Changes

- Touch only files required by the Issue.
- Match the existing style and package boundaries.
- Do not refactor unrelated code while implementing a feature.
- Do not add speculative abstractions, providers, configuration, or databases.
- Remove unused code introduced by your change, but do not clean up unrelated code.
- Keep provider integrations behind explicit interfaces and preserve deterministic development fallbacks.

## 4. Source of Truth and Architecture

- `SPEC-editorial-motion-v1.md` defines the product scope and acceptance intent.
- `README.md` defines setup and user-facing workflows.
- `docs/adr/` records architectural decisions; add an ADR for durable cross-cutting decisions.
- `apps/api` owns input validation, jobs, orchestration, and API behavior.
- `apps/renderer` owns Remotion compositions and video rendering.
- `apps/vision-service` owns Python vision contracts and image-processing stages.
- `packages/*` contain reusable schemas, motion logic, and shared utilities.
- `tests/fixtures` contains the fixture catalog and fixture contract documentation.

When sources disagree, do not silently choose. Document the conflict in the PR and update the appropriate source of truth.

## 5. Issue, Branch, and Pull Request Workflow

Every non-trivial change must follow this workflow:

1. Select or create a GitHub Issue describing the correction, improvement, or new function.
2. Start from the latest `main`.
3. Create a new branch using the `codex/` prefix, for example `codex/12-scene-schema-validation`.
4. Make focused commits that reference the Issue when useful.
5. Run all quality gates locally.
6. Push the branch and open a PR against `main`.
7. Reference the Issue with `Refs #N`, `Fixes #N`, or the appropriate GitHub keyword.
8. Do not merge or deploy unless the user explicitly requests that action.

One PR should represent one coherent unit of work. Include verification commands and known limitations in the PR description.

## 6. Quality Gates Are Mandatory

Never bypass hooks with `--no-verify`.

Before pushing, run:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

The repository hooks run these checks through `scripts/quality-gate.sh`. The GitHub workflow must remain a quality gate only; it must not deploy the project.

For Python changes, also run:

```bash
python -m pytest -q apps/vision-service/tests
```

For renderer changes, validate the local output when applicable:

```bash
pnpm --filter @editorial-motion/renderer exec tsx src/render.ts
./scripts/acceptance-check.sh apps/renderer/out/scene01.mp4
```

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

## 9. Dependencies and Local Infrastructure

- Use the package manager declared in `package.json` (`pnpm@10.0.0`).
- Do not introduce PostgreSQL, Redis, or other infrastructure without an approved Issue; the current V1 workflow is local and in-memory.
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
