# Motion style — editorial-documentary motion bible (operational)

How to write motion prompts and plans that the system accepts and that look
right. Derived from `SPEC-editorial-motion-v1.md` §5, §12, §20, and §29.2,
cross-checked against what `packages/motion-engine` and `apps/renderer`
actually execute today.

Two kinds of rules live here:

- **Engine rules** — hard limits enforced by code (`validateMotionPlan`,
  Zod schemas, `resolveLayerState`). A plan that violates them fails at
  `validating_plan` with `MOTION_PLAN_INVALID`.
- **Style directives** — not enforced by code; the planner system prompt and
  this guide encode them. Violations render but look wrong.

## 1. Principles

The animation system prioritizes information hierarchy over spectacle
(SPEC §5.1). Every motion decision should answer: *does this help the viewer
read the scene faster?*

- Editorial, documentary, explanatory — restrained, clean, readable within
  seconds.
- Motion reveals hierarchy and relationships; it never decorates for its own
  sake (SPEC §12.1 rule 7).
- Prefer sequential entrances over simultaneous motion; never animate every
  element at once without an explicit reason (§12.1 rules 5–6).
- Preserve original landing coordinates — elements end where they sit in the
  source image (§12.1 rule 3; visual-integrity target §29.1).
- Static camera is the default; movement needs explicit request or strong
  justification (§5.2).

## 2. Rhythm

Preferred sequence (§5.3):

```text
establish background → reveal primary elements → reveal relationships /
routes / arrows → emphasis → final hold
```

Reference timing for a typical 8-second scene:

```text
0.00–0.40  establish
0.40–2.80  primary element entrances
2.80–5.50  explanatory overlays / routes / highlights
5.50–8.00  final hold
```

The planner may adapt to the prompt, but final readability is mandatory.
Engine constraints that shape the rhythm: `durationSeconds` is at least 8;
every event must finish inside the duration (§12.1 rule 12); the final hold
should be ≥ 1.5 s (engine warning below that; §12.1 rule 13 recommends
2.0–2.5 s for 8-second scenes); `finalHold` is a required plan field.

## 3. Camera

| Rule | Kind |
|---|---|
| `static` is the default | style (planner prompt) |
| `subtle_zoom_in` / `subtle_zoom_out` / `subtle_pan` only when requested or justified | style |
| Scale delta ≤ 6 % (`scaleFrom` → `scaleTo`) | engine (`validateMotionPlan`) |
| Pan ≤ 5 % of canvas width/height per axis | engine |
| Rotation disabled, camera shake forbidden | style — note the schema has no rotation field, so it is unrepresentable |
| Camera params lerp linearly over `start`/`duration` in the renderer | engine behavior |

Prompt vocabulary: `Static camera.` normalizes to `{"camera":{"type":"static"}}`.

## 4. Motion primitives

### 4.1 What the engine actually executes today

`resolveLayerState` (`packages/motion-engine/src/index.ts`) maps events to
layer state (`opacity`, `translateX/Y`, `scale`, `revealProgress`); the
renderer applies them as CSS opacity/transform and a left-to-right
`clip-path` inset for reveals.

| Event type | Behavior | Notes |
|---|---|---|
| `fade_in` | opacity 0 → 1 | pre-start state is opacity 0 |
| `scale_in` | scale 0 → 1 | grows from its anchor point (default 0.5/0.5) |
| `drop` | translateY from above, −`distanceRatio` of canvas height (default 0.08) → 0 | `params.fade: true` fades in with the drop |
| `slide_up` / `slide_down` / `slide_left` / `slide_right` | enter from ±`distanceRatio` (default 0.08) → 0 | direction names the entry side relative to rest |
| `wipe_reveal`, `mask_reveal`, `draw_path`, `draw_arrow` | `revealProgress` 0 → 1, clipped left-to-right | routes/arrows draw linearly; `persist: true` keeps the drawn state |
| `hold` | identity | the final state simply persists |

### 4.2 Schema-legal but not yet animated

Declared in `motion-schema` but no-ops in `resolveLayerState`:
`assemble`, `highlight`, `circle_emphasis`, `underline`, `shift`,
`separate_layers`. Plans using them pass validation but produce no visible
motion — treat them as unavailable when planning.

### 4.3 SPEC primitives not yet in the schema

SPEC §5.4 also lists `connect`, `region_reveal`, `step_reveal`, `stack`,
`unstack`, `freeze`. These are **not valid event types** in
`motionEventTypeSchema` — a plan containing them fails schema parse at
`validating_plan`. Use the §4.1 equivalents (`draw_arrow`, `mask_reveal`,
`hold` + `persist`).

### 4.4 Forbidden motion (§5.5)

Reject or normalize: heavy bounce, rubber motion, exaggerated overshoot,
explosions, lens flares, glow bursts, spinning objects, 3D flips, extreme
perspective, camera shake, glitch spam, neon effects, trailer-style flashes,
random particle systems, decorative motion without explanatory purpose.

The engine contributes two structural guards: only the 15 event types in
§4.1–4.2 are representable, and easing is limited to `linear`,
`editorialOut`, `editorialInOut` — there is no spring/overshoot easing to
abuse. If Remotion spring helpers are ever introduced, overshoot must be
effectively disabled (§5.6).

## 5. Easing

Default editorial easing is smooth and non-bouncy (§5.6):

| Name | Curve |
|---|---|
| `editorialOut` | cubic-bezier(0.22, 1.00, 0.36, 1.00) — default feel for entrances |
| `editorialInOut` | cubic-bezier(0.65, 0.00, 0.35, 1.00) — for emphasis and camera |
| `linear` | for `draw_path` / `draw_arrow` (SPEC `linearDraw`) |

These are the only three values `easingNameSchema` accepts; the engine
implements them as cubic-out, cubic-in-out, and linear.

## 6. Protected content

Defaults (§20): text regions, statistic placeholders, and logos are
protected; titles are static unless explicitly targeted.

- **Engine rule:** events targeting a `protected: true` element or any
  `protectedRegions` id are hard errors (`Protected target cannot be
  animated`), as are unknown target ids.
- Prompt vocabulary: `lock` / `freeze` / `persist` → the target stays in its
  final state (`persist: true`) for the rest of the scene (§12.1 rule 15);
  `leave ... empty` → protected regions stay untouched (rule 16).
- Never invent, rewrite, or synthesize text (rules 17–19) — no generated
  gibberish typography (§29.1).

## 7. Motion roles

`motionRole` on each `SceneElement` tells the planner how an element may
participate. Mapping to practice:

| Role | Meaning | Typical events |
|---|---|---|
| `primary` | carries the story; enters first, one at a time | `drop`, `fade_in`, `scale_in` |
| `secondary` | supporting context; enters after primaries | `fade_in`, `slide_*` |
| `connector` | routes, arrows, lines; revealed after their anchors land | `draw_path`, `draw_arrow` with `persist: true` |
| `static` | stays put; may be revealed but not displaced | `mask_reveal` on the region, or nothing |
| `protected` | never animated (engine-enforced) | — |

## 8. Animation families

The fixture manifest (`tests/fixtures/manifest.json`) names the nine scene
archetypes V1 must handle. Each maps onto the principles above:

| Family | Principle in practice | Key prompt cues | Engine notes |
|---|---|---|---|
| `drop-and-route-reveal` | Primaries drop in sequence (0.40–2.80 s window), then routes draw outward; routes lock | "Drop the three … sequentially, then draw outward …", "Lock routes" | `drop` + `draw_path`/`draw_arrow`, `persist: true` on routes; `drop` supports `params.fade` |
| `sequential-reveal` | Ordered entrances: documents first, then people/timeline events; chronological order when the scene has one | "Reveal X first, then …" | stagger `start`s; keep entrances 0.5–1.0 s each |
| `node-and-connector` | Central node lands first, surrounding nodes follow, arrows connect last | "Reveal the central node, then connect …" | anchors → `connector` roles get `draw_arrow` after nodes rest |
| `step-reveal` | Region reveals left-to-right, then a single emphasis on the endpoint | "Reveal … from left to right and highlight the final data point" | left-to-right clip is the only reveal direction implemented today |
| `route-reveal` | Draw existing route lines as-is; raster style preserved, camera static | "Keep the camera static and draw the existing route lines without changing their raster style" | `draw_path` on the route element; no recoloring/redrawing exists in the engine |
| `protected-region` | Animate the illustration around untouched statistic boxes | "… leaving all three statistic boxes untouched" | protected ids rejected by the validator |
| `protected-typography` | Reveal editorial elements around the headline; typography never modified or regenerated | "… without modifying the existing typography" | headline/subtitle as protected regions |
| `separate-layers` | Overlapping layers separate subtly and settle back into original positions | "Separate the overlapping paper layers subtly and settle them back" | `separate_layers` is schema-legal but a **no-op in the engine today** — plan a `hold`/reveal fallback until it is implemented |
| `fallback-or-error` | When an object cannot be isolated confidently, prefer a restrained reveal over motion; if even that fails, fail explicitly | "Attempt a restrained reveal and use a safe fallback if …" | matches SPEC §19: reveal rather than move → whole-region reveal → explicit failure |

## 9. Prompt-writing checklist

Before considering a prompt done, verify:

1. Every animated target id exists in the SceneAnalysis and is not protected.
2. Camera is `static` unless the prompt justifies otherwise; deltas within
   6 % scale / 5 % pan.
3. Entrances are sequential with staggered starts, each 0.5–1.0 s.
4. Connectors draw only after their anchor elements have landed, and persist.
5. All events end inside `durationSeconds`; final hold ≥ 1.5 s (2.0–2.5 s
   preferred for 8 s scenes).
6. No forbidden motion (§4.4) and no invented text.
7. Landing positions equal the source composition; `lock`/`freeze`/`persist`
   cues set `persist: true`.

## 10. What enforces what (quick reference)

| Constraint | Enforced by |
|---|---|
| Protected targets never animated; unknown targets rejected | engine — `validateMotionPlan` (error) |
| Events fit inside duration | engine — error |
| Camera scale ≤ 6 %, pan ≤ 5 % | engine — error |
| Final hold < 1.5 s | engine — warning only |
| `durationSeconds` ≥ 8, `stylePreset` fixed | engine — schema |
| Static camera default, sequential entrances, rhythm, no decoration | style — planner system prompt (`apps/api/src/llm-providers.ts`) |
| Forbidden effects, no text synthesis | style — planner prompt + prompt checklist; partially structural (easing/types limited by schema) |
| Final hold static, no one-frame jumps, editorial-not-promotional feel | style — review against `docs/v1-acceptance.md` editorial safety checks |
