# V1 fixture catalog

`manifest.json` is the canonical fixture contract for the V1 pipeline. Each fixture defines:

- the source image filename;
- a representative motion prompt;
- expected semantic targets;
- protected regions that must not be altered;
- the expected animation family.

Source images are intentionally not fabricated or generated as placeholders. Add an image only when it is cleared for repository use, then place it next to this manifest and set its status to available in the fixture PR.

Every fixture test should eventually verify:

1. SceneAnalysis identifies the expected targets.
2. Protected regions remain untouched.
3. Layers have non-empty alpha masks.
4. The MotionPlan validates against available target IDs.
5. The renderer produces a readable final hold.
