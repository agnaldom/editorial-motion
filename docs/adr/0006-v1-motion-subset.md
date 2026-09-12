# ADR-0006: V1 motion subset follows the §11.2 DSL, not the full §5.4 primitive list

- Status: Accepted (emendado em 2026-09-11, issue #126)
- Date: 2026-09-09

## Context

SPEC §5.4 lists the motion concepts V1 must support, including multi-element
effects (`connect`, `region_reveal`, `step_reveal`, `stack`, `unstack`) and
final-state keywords (`freeze`, `persist`). SPEC §11.2 defines the machine
canonical `MotionEventType` union, which is smaller: it only contains event
types expressible as single-target, time-ranged operations on one layer's
state (`opacity`, `translate`, `scale`, `revealProgress`) or as renderer-drawn
overlays. The two lists disagree, and the schema/engine can only implement one
contract.

## Decision

The schema (`motion-schema`) and engine (`motion-engine`) treat §11.2 as the
canonical V1 surface. All §11.2 types have defined behavior:

- Layer-state effects: entrances (`fade_in`, `slide_*`, `drop`, `scale_in`,
  `wipe_reveal`, `mask_reveal`, `assemble`), layout motion (`shift`,
  `separate_layers`), reveal (`draw_path`, `draw_arrow`).
- Renderer-drawn overlays with no layer-state effect: `highlight`,
  `circle_emphasis`, `underline`.
- Timeline-only: `hold`.

§5.4 types absent from §11.2 — `connect`, `region_reveal`, `step_reveal`,
`stack`, `unstack`, `freeze` — are deferred. They require cross-element
coordination (two targets, scene regions, or layer-group bookkeeping) that the
single-target `MotionEvent` model cannot express without a DSL revision.
`persist` already exists as an event flag, not an event type.

## Consequences

Plans referencing deferred types fail closed: the Zod enum rejects them at
`motionPlanSchema.parse` with a clear error before any render. Extending V1 to
those primitives requires a DSL change (multi-target events or scene-level
directives) plus an ADR amendment, not just an engine case.

## Emenda (2026-09-11, issue #126)

Os seis tipos deferidos foram implementados **sem revisão do DSL**: a
coordenação cross-element que motivou o deferimento coube em `params`, dentro
do modelo single-target do `MotionEvent`:

| Tipo §5.4 | Forma §11.2-compatível |
|---|---|
| `connect` | Evento no alvo origem; `params.to` aponta o segundo elemento (overlay desenhado pelo renderer entre os dois placements) |
| `region_reveal` | Evento na layer; `params.region {x,y,width,height}` define a janela; múltiplos eventos acumulam janelas via máscara SVG |
| `step_reveal` | Como wipe, com `params.steps` quantizando o progresso |
| `stack` / `unstack` | `params.order` + `params.spreadRatio` dão o deslocamento ordenado por z-order; o stagger continua vindo de `start` |
| `freeze` | Evento por layer; `start` é o instante em que o tempo da layer congela (clamp determinístico no engine) |

Parâmetros são validados deterministicamente em `validateMotionPlan`. O
deferimento anterior sobre "requerer revisão de DSL" fica substituído: §5.4
está atendido na forma single-target.
