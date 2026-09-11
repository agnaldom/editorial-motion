# Galeria de exemplos — prompt → plano → vídeo

Cinco composições representativas conectam o que o usuário pede (prompt) ao que
o sistema deve produzir (plano de motion) e ao que deve ser visto no vídeo.
Cada exemplo é versionado em
[`apps/renderer/src/examples/gallery.ts`](../apps/renderer/src/examples/gallery.ts)
com: `prompt`, `sceneAnalysis` de referência, `sceneProps` (plano completo) e
`expectedMotionTypes` — a âncora de regressão do smoke automatizado
(`apps/renderer/src/examples.spec.ts`, rodando no CI no job *Renderer smoke + API
integration* via `pnpm --filter @editorial-motion/renderer snapshot`).

O smoke renderiza cada exemplo em MP4 curto (~2s, 640×360) e valida:

1. o plano passa no `motionPlanSchema` e no `validateMotionPlan` contra a
   análise de referência;
2. o plano contém os gestos esperados (`expectedMotionTypes`);
3. o render produz um MP4 válido (box `ftyp`).

Os vídeos de referência completos (8s, 2560×1440) são gerados localmente com o
mesmo plano — não são versionados em git.

## 1. `collage-assemble` — Collage editorial, montagem sequencial

- **Prompt:** "Assemble the paper plates one by one, then hold the composition."
- **O que olhar no vídeo:** as quatro placas de papel entram uma de cada vez
  (stagger de ~0.7s), cada uma com fade + escala suave vindo de 0.9, sem
  sobreposição de movimentos; a partir de ~3.5s a composição fica congelada.
- **Gestos:** `assemble` ×4 (persist) · câmera `static`.

## 2. `map-separate-routes` — Mapa: placas se separam e rotas se desenham

- **Prompt:** "Separate the map plates slightly, then draw the trade routes
  toward the coast."
- **O que olhar no vídeo:** as duas placas do mapa se afastam sutilmente em
  direções opostas (~6% do canvas, easing editorialInOut); quando param, a rota
  dourada se desenha progressivamente da esquerda para a direita (traçado
  linear) e permanece no quadro.
- **Gestos:** `separate_layers` ×2 (up/down, persist) · `draw_path` (linear,
  persist, via máscara de rota) · câmera `static`.

## 3. `diagram-nodes-flow` — Diagrama de fluxo: nós caem e setas conectam

- **Prompt:** "Drop the flow nodes in sequence, then connect them with arrows."
- **O que olhar no vídeo:** três nós caem em sequência vindo de cima com fade
  (drop, ~0.8s cada); quando o último pousa, as duas setas se desenham
  progressivamente ligando a cadeia e travam no estado final.
- **Gestos:** `drop` ×3 (fade, persist, stagger) · `draw_arrow` ×2 (linear,
  persist) · câmera `static`.

## 4. `infographic-protected` — Infográfico: reveal com números protegidos

- **Prompt:** "Reveal the chart regions left to right and highlight the peak.
  Keep the stat boxes untouched."
- **O que olhar no vídeo:** a região do gráfico se revela da esquerda para a
  direita (wipe); em seguida um anel de destaque envolve o gráfico (highlight
  persist). As caixas de estatística à direita **nunca se movem** — são
  região protegida.
- **Gestos:** `wipe_reveal` (direction left, persist) · `highlight` (persist).
- **Proteção:** `stat-box` com `protected: true` + `protectedRegions`; o
  validador do engine rejeitaria qualquer evento a ela dirigido.

## 5. `depth-parallax` — Cena sem elementos: parallax de profundidade

- **Prompt:** "No clear objects here; give the composition a subtle editorial
  parallax."
- **O que olhar no vídeo:** é o fallback de depth layering (issue #121). Nada
  "entra" na cena além de um fade do foreground; o movimento vem do **contraste
  relativo** — a câmera faz um pan mínimo (4%) para a direita enquanto o
  recorte saliente desliza 3% para a esquerda, criando parallax entre os
  planos. Não é um zoom na imagem inteira.
- **Gestos:** `fade_in` + `shift` (dxRatio −0.03, editorialInOut) · câmera
  `subtle_pan` (±2%, 0–6.4s).

## Como usar como referência de regressão

- **Mudanças no engine/renderer:** os gestos esperados de cada exemplo são
  assertados no smoke; uma mudança que remova ou renomeie um gesto quebra o
  teste do exemplo afetado.
- **Mudanças no planner:** o plano versionado aqui é a especificação do que o
  planner (LLM ou determinístico) deve produzir para o prompt dado numa cena
  equivalente — desvios visuais devem ser comparados contra este documento,
  gesto por gesto.
- **Novo exemplo:** adicionar um item em `gallery.ts` com os cinco campos e um
  parágrafo aqui; o smoke e o CI passam a cobri-lo automaticamente.
