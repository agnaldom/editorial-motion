# V1 fixture catalog

`manifest.json` is the canonical fixture contract for the V1 pipeline. Each fixture defines:

- the source image filename;
- a representative motion prompt;
- expected semantic targets;
- protected regions that must not be altered;
- the expected animation family.

## Source images

The 10 scenes are synthetic editorial-style compositions generated deterministically
by `generate.mjs` (`pnpm fixtures:generate` from the repo root). They are intentionally
generated rather than collected: ground truth is exact (every drawn shape is a manifest
target), there are no licensing constraints, and re-running the script reproduces
byte-identical PNGs (fixed-seed PRNG only). Regenerate and commit whenever a scene
needs to change.

Every fixture test should eventually verify:

1. SceneAnalysis identifies the expected targets.
2. Protected regions remain untouched.
3. Layers have non-empty alpha masks.
4. The MotionPlan validates against available target IDs.
5. The renderer produces a readable final hold.
