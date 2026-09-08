# editorial-motion

`editorial-motion` turns a still editorial image and a natural-language motion prompt into a short, deterministic documentary-style animation.

The `SPEC-editorial-motion-v1.md` file is the functional and architectural contract for V1.

## Required workflow

Every correction, improvement, or new feature must be traceable in GitHub:

1. **Create or identify an Issue before coding.** Include context, scope, acceptance criteria, and the relevant SPEC milestone. If the work introduces an architectural decision, add an ADR under `docs/adr/`.
2. **Use a new branch for every change.** Branch from `main`, preferably using `codex/<issue>-<slug>`, and open a PR linked to the Issue with `Closes #N` or `Refs #N`.
3. **Run locally.** There is no deployment at this stage. Validate the change locally and include the commands and results in the PR.
4. **Use local quality gates.** Install the versioned `pre-commit` and `pre-push` hooks with `./scripts/install-hooks.sh`.
5. **Review and merge.** A PR must describe the behavior changed, validation evidence, risks, and configuration. Merge only after review, local checks, and green CI when a CI workflow is available.
6. **Close the loop.** Update the Issue with the implementation result, PR, validation evidence, and follow-up work.

## Scope rules

- The LLM must output validated Motion DSL JSON, never arbitrary React or Remotion code.
- Preserve the SPEC contracts: static camera by default, normalized coordinates, protected regions, deterministic Remotion rendering, and 2560×1440 at 30 fps with a minimum duration of 8 seconds.
- Changes to the architectural decisions in SPEC section 40 require an ADR and explicit PR approval.
- Never commit secrets, uploads, generated render artifacts, or credentials. Use environment variables and signed URLs.

## Pull request convention

Every PR must include:

```text
Issue: #<number>
Type: Fix | Improvement | New feature
SPEC milestone: <M0–M7 or applicable section>
Acceptance criteria: <checklist>
Local validation: <commands and results>
Reversal plan: <risk and recovery plan>
```

Keep the title concise and include the Issue when possible, for example:
`feat(#12): implement the Motion DSL contract`.

The initial Issues should follow the SPEC milestones:

```text
skeleton → Motion DSL → analysis/segmentation → background cleanup
→ motion planner → routes → one-click flow → hardening
```

Record dependencies in both the Issue and the PR. Do not bypass a dependency merely to speed up a merge.

## Local quality gates

Install the hooks once per clone:

```bash
./scripts/install-hooks.sh
```

The `pre-commit` hook checks for sensitive files and generated artifacts. The `pre-push` hook runs the full quality gate available in the repository, including JavaScript/TypeScript checks and Python checks when those projects are present.

Until the package manager is bootstrapped and a lockfile exists, JavaScript checks are reported as pending rather than silently skipped. There is no deployment workflow yet.

## Local configuration

Copy `.env.example` to `.env` and adjust local service values as the services are implemented. PostgreSQL and Redis are part of the planned local development stack; no credentials belong in Git.

