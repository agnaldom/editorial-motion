# V1 Acceptance Checklist

This checklist is the local release gate for the first Editorial Motion version. It does not deploy anything.

## Reference run

1. Install dependencies with `pnpm install`.
2. Render the reference composition:

   ```bash
   pnpm --filter @editorial-motion/renderer exec tsx src/render.ts
   ```

3. Inspect the generated video:

   ```bash
   ./scripts/acceptance-check.sh apps/renderer/out/scene01.mp4
   ```

The check requires an 8-second MP4 at 2560×1440 and 30 fps using H.264. The output is a local artifact and is intentionally ignored by Git.

## Editorial safety checks

- [ ] Numerical zones remain unchanged in the reference scene.
- [ ] Protected text and labels are not animated or regenerated.
- [ ] Route reveals preserve the original raster style.
- [ ] The final frame holds the complete composition without an unintended camera move.
- [ ] The rendered MP4 opens and plays from start to finish.

Record visual evidence in the release PR, including the exact render command and output path. If a criterion fails, open or reference a corrective Issue before merging.

## Release and rollback

- Release means merging the reviewed PR into `main`; there is no deployment step in V1.
- The local rollback is `git revert <merge-commit>` followed by rerunning the quality gates and this checklist.
- Never rewrite `main` history or delete the source fixture while investigating a failed acceptance run.
