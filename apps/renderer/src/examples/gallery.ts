import type {SceneAnalysis} from '@editorial-motion/scene-schema';
import type {SceneProps} from '../scene-props';

export type GalleryExample = {
  name: string;
  title: string;
  prompt: string;
  description: string;
  expectedMotionTypes: string[];
  sceneAnalysis: SceneAnalysis;
  sceneProps: SceneProps;
};

const svgAsset = (body: string): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2560 1440">${body}</svg>`)}`;

const plate = (color: string, chip: string): string =>
  svgAsset(`<rect width="2560" height="1440" rx="48" fill="${color}"/><rect x="140" y="1180" width="900" height="120" rx="24" fill="${chip}"/>`);

const analysis = (compositionType: SceneAnalysis['compositionType'], elements: SceneAnalysis['elements']): SceneAnalysis => ({
  version: '1',
  sceneId: 'gallery',
  source: {width: 2560, height: 1440, aspectRatio: 16 / 9},
  compositionType,
  elements,
  protectedRegions: [],
});

const basePlan = {
  version: '1' as const,
  sceneId: 'gallery',
  stylePreset: 'editorial-documentary' as const,
  durationSeconds: 8,
  fps: 30,
  canvas: {width: 2560, height: 1440},
};

const element = (overrides: Partial<SceneAnalysis['elements'][number]> & {id: string}): SceneAnalysis['elements'][number] => ({
  label: overrides.id,
  type: 'cutout',
  bbox: {x: 0.1, y: 0.1, width: 0.3, height: 0.3},
  confidence: 0.9,
  zIndex: 1,
  animatable: true,
  protected: false,
  motionRole: 'primary',
  source: 'vision',
  ...overrides,
});

export const galleryExamples: GalleryExample[] = [
  {
    name: 'collage-assemble',
    title: 'Collage editorial — montagem sequencial',
    prompt: 'Assemble the paper plates one by one, then hold the composition.',
    description: 'Quatro placas de papel entram em sequência (assemble com stagger de 0.7s), cada uma com fade + escala suave de 0.9, e a composição congela no estado final.',
    expectedMotionTypes: ['assemble'],
    sceneAnalysis: analysis('editorial-collage', [
      element({id: 'plate-a', type: 'cutout', zIndex: 1}),
      element({id: 'plate-b', type: 'cutout', zIndex: 2}),
      element({id: 'plate-c', type: 'cutout', zIndex: 3}),
      element({id: 'plate-d', type: 'cutout', motionRole: 'secondary', zIndex: 4}),
    ]),
    sceneProps: {
      background: svgAsset('<rect width="2560" height="1440" fill="#f4f1ea"/>'),
      plan: {
        ...basePlan,
        camera: {type: 'static'},
        events: [
          {id: 'evt-a', type: 'assemble', targetId: 'plate-a', start: 0.4, duration: 0.8, easing: 'editorialOut', persist: true},
          {id: 'evt-b', type: 'assemble', targetId: 'plate-b', start: 1.1, duration: 0.8, easing: 'editorialOut', persist: true},
          {id: 'evt-c', type: 'assemble', targetId: 'plate-c', start: 1.8, duration: 0.8, easing: 'editorialOut', persist: true},
          {id: 'evt-d', type: 'assemble', targetId: 'plate-d', start: 2.5, duration: 0.8, easing: 'editorialOut', persist: true},
        ],
        finalHold: {start: 3.5, duration: 4.5},
      },
      layers: [
        {elementId: 'plate-a', asset: plate('#274c63', '#f4f1ea'), placement: {x: 0.08, y: 0.12, width: 0.38, height: 0.34, zIndex: 1}},
        {elementId: 'plate-b', asset: plate('#c05621', '#f4f1ea'), placement: {x: 0.54, y: 0.12, width: 0.38, height: 0.34, zIndex: 2}},
        {elementId: 'plate-c', asset: plate('#2f855a', '#f4f1ea'), placement: {x: 0.08, y: 0.54, width: 0.38, height: 0.34, zIndex: 3}},
        {elementId: 'plate-d', asset: plate('#b7791f', '#f4f1ea'), placement: {x: 0.54, y: 0.54, width: 0.38, height: 0.34, zIndex: 4}},
      ],
    },
  },
  {
    name: 'map-separate-routes',
    title: 'Mapa — placas se separam e rotas se desenham',
    prompt: 'Separate the map plates slightly, then draw the trade routes toward the coast.',
    description: 'Duas placas do mapa se afastam sutilmente (separate_layers, 6%) e, em seguida, a rota dourada se desenha progressivamente (draw_path linear) e permanece.',
    expectedMotionTypes: ['separate_layers', 'draw_path'],
    sceneAnalysis: analysis('map', [
      element({id: 'plate-north', type: 'map_region', zIndex: 1}),
      element({id: 'plate-south', type: 'map_region', zIndex: 2}),
      element({id: 'route-gold', type: 'route', motionRole: 'connector', zIndex: 3}),
    ]),
    sceneProps: {
      background: svgAsset('<rect width="2560" height="1440" fill="#e8e4d8"/><path d="M0 720 H2560" stroke="#d5cfc0" stroke-width="6"/>'),
      plan: {
        ...basePlan,
        camera: {type: 'static'},
        events: [
          {id: 'evt-sep-n', type: 'separate_layers', targetId: 'plate-north', start: 0.4, duration: 1.6, easing: 'editorialInOut', persist: true, params: {direction: 'up', distanceRatio: 0.06}},
          {id: 'evt-sep-s', type: 'separate_layers', targetId: 'plate-south', start: 0.4, duration: 1.6, easing: 'editorialInOut', persist: true, params: {direction: 'down', distanceRatio: 0.06}},
          {id: 'evt-route', type: 'draw_path', targetId: 'route-gold', start: 2.4, duration: 2, easing: 'linear', persist: true},
        ],
        finalHold: {start: 4.6, duration: 3.4},
      },
      layers: [
        {elementId: 'plate-north', asset: svgAsset('<path d="M200 80 L1200 40 L1360 620 L240 700 Z" fill="#4a7c59"/>'), placement: {x: 0.08, y: 0.06, width: 0.45, height: 0.44, zIndex: 1}},
        {elementId: 'plate-south', asset: svgAsset('<path d="M300 60 L1280 120 L1180 660 L180 600 Z" fill="#8f5f3c"/>'), placement: {x: 0.47, y: 0.5, width: 0.44, height: 0.44, zIndex: 2}},
        {
          elementId: 'route-gold',
          asset: svgAsset('<path d="M300 500 C 800 200, 1400 900, 2200 420" stroke="#c9a227" stroke-width="48" fill="none" stroke-linecap="round"/>'),
          placement: {x: 0.1, y: 0.15, width: 0.8, height: 0.7, zIndex: 3},
          routePaths: [[[0.11, 0.69], [0.41, 0.27], [0.65, 0.81], [0.9, 0.41]] as [number, number][]],
        },
      ],
    },
  },
  {
    name: 'diagram-nodes-flow',
    title: 'Diagrama de fluxo — nós caem e setas conectam',
    prompt: 'Drop the flow nodes in sequence, then connect them with arrows.',
    description: 'Três nós do fluxo caem em sequência (drop com fade) e, quando pousam, as setas se desenham (draw_arrow linear, persist) conectando a cadeia.',
    expectedMotionTypes: ['drop', 'draw_arrow'],
    sceneAnalysis: analysis('diagram', [
      element({id: 'node-start', type: 'icon', zIndex: 1}),
      element({id: 'node-check', type: 'icon', zIndex: 2}),
      element({id: 'node-end', type: 'icon', motionRole: 'secondary', zIndex: 3}),
      element({id: 'edge-1', type: 'arrow', motionRole: 'connector', zIndex: 4}),
      element({id: 'edge-2', type: 'arrow', motionRole: 'connector', zIndex: 5}),
    ]),
    sceneProps: {
      background: svgAsset('<rect width="2560" height="1440" fill="#f7f5ef"/>'),
      plan: {
        ...basePlan,
        camera: {type: 'static'},
        events: [
          {id: 'evt-n1', type: 'drop', targetId: 'node-start', start: 0.4, duration: 0.8, easing: 'editorialOut', persist: true, params: {distanceRatio: 0.08, fade: true}},
          {id: 'evt-n2', type: 'drop', targetId: 'node-check', start: 1.1, duration: 0.8, easing: 'editorialOut', persist: true, params: {distanceRatio: 0.08, fade: true}},
          {id: 'evt-n3', type: 'drop', targetId: 'node-end', start: 1.8, duration: 0.8, easing: 'editorialOut', persist: true, params: {distanceRatio: 0.08, fade: true}},
          {id: 'evt-e1', type: 'draw_arrow', targetId: 'edge-1', start: 2.6, duration: 0.9, easing: 'linear', persist: true},
          {id: 'evt-e2', type: 'draw_arrow', targetId: 'edge-2', start: 3.1, duration: 0.9, easing: 'linear', persist: true},
        ],
        finalHold: {start: 4.2, duration: 3.8},
      },
      layers: [
        {elementId: 'node-start', asset: svgAsset('<circle cx="1280" cy="720" r="360" fill="#274c63"/><rect x="1040" y="660" width="480" height="120" rx="24" fill="#f4f1ea"/>'), placement: {x: 0.02, y: 0.25, width: 0.2, height: 0.5, zIndex: 1}},
        {elementId: 'node-check', asset: svgAsset('<rect width="1440" height="1440" rx="200" fill="#c05621"/><rect x="340" y="640" width="760" height="160" rx="32" fill="#f4f1ea"/>'), placement: {x: 0.4, y: 0.25, width: 0.2, height: 0.5, zIndex: 2}},
        {elementId: 'node-end', asset: svgAsset('<circle cx="1280" cy="720" r="360" fill="#2f855a"/><rect x="1040" y="660" width="480" height="120" rx="24" fill="#f4f1ea"/>'), placement: {x: 0.78, y: 0.25, width: 0.2, height: 0.5, zIndex: 3}},
        {elementId: 'edge-1', asset: svgAsset('<path d="M120 720 H1240" stroke="#7a7368" stroke-width="40" stroke-linecap="round" fill="none"/>'), placement: {x: 0.2, y: 0.46, width: 0.22, height: 0.08, zIndex: 4}, routePaths: [[[0, 0.5], [1, 0.5]] as [number, number][]]},
        {elementId: 'edge-2', asset: svgAsset('<path d="M120 720 H1240" stroke="#7a7368" stroke-width="40" stroke-linecap="round" fill="none"/>'), placement: {x: 0.58, y: 0.46, width: 0.22, height: 0.08, zIndex: 5}, routePaths: [[[0, 0.5], [1, 0.5]] as [number, number][]]},
      ],
    },
  },
  {
    name: 'infographic-protected',
    title: 'Infográfico — reveal com números protegidos',
    prompt: 'Reveal the chart regions left to right and highlight the peak. Keep the stat boxes untouched.',
    description: 'A região do gráfico se revela da esquerda para a direita (wipe_reveal) e o pico recebe um destaque (highlight persist). As caixas de estatística nunca são animadas (protected).',
    expectedMotionTypes: ['wipe_reveal', 'highlight'],
    sceneAnalysis: {
      ...analysis('infographic', [
        element({id: 'chart-region', type: 'chart', bbox: {x: 0.05, y: 0.1, width: 0.6, height: 0.75}, zIndex: 1}),
        element({id: 'stat-box', type: 'stat_box', bbox: {x: 0.7, y: 0.1, width: 0.25, height: 0.75}, animatable: false, protected: true, motionRole: 'protected', zIndex: 2}),
      ]),
      protectedRegions: [{id: 'stat-box', label: 'Stat box', bbox: {x: 0.7, y: 0.1, width: 0.25, height: 0.75}, reason: 'statistics stay untouched'}],
    },
    sceneProps: {
      background: svgAsset('<rect width="2560" height="1440" fill="#f4f1ea"/>'),
      plan: {
        ...basePlan,
        camera: {type: 'static'},
        events: [
          {id: 'evt-wipe', type: 'wipe_reveal', targetId: 'chart-region', start: 0.4, duration: 1.6, easing: 'editorialOut', persist: true, params: {direction: 'left'}},
          {id: 'evt-hl', type: 'highlight', targetId: 'chart-region', start: 2.4, duration: 1.2, easing: 'editorialOut', persist: true},
        ],
        finalHold: {start: 3.8, duration: 4.2},
      },
      layers: [
        {elementId: 'chart-region', asset: svgAsset('<rect x="120" y="240" width="560" height="1000" fill="#274c63"/><rect x="760" y="520" width="560" height="720" fill="#c05621"/><rect x="1400" y="120" width="560" height="1120" fill="#2f855a"/>'), placement: {x: 0.05, y: 0.1, width: 0.6, height: 0.75, zIndex: 1}},
      ],
    },
  },
  {
    name: 'depth-parallax',
    title: 'Cena sem elementos — parallax de profundidade',
    prompt: 'No clear objects here; give the composition a subtle editorial parallax.',
    description: 'Fallback de depth layering (issue #121): a câmera executa um pan mínimo de 4% e o foreground saliente desloca 3% em direção oposta — o movimento relativo entre os planos cria o parallax editorial.',
    expectedMotionTypes: ['fade_in', 'shift'],
    sceneAnalysis: analysis('photo', [
      element({id: 'depth-foreground', type: 'cutout', bbox: {x: 0.3, y: 0.2, width: 0.4, height: 0.6}, source: 'derived'}),
    ]),
    sceneProps: {
      background: svgAsset('<rect width="2560" height="1440" fill="#e2ddd2"/><circle cx="2080" cy="360" r="200" fill="#d5cfc0"/>'),
      plan: {
        ...basePlan,
        camera: {type: 'subtle_pan', start: 0, duration: 6.4, params: {xFrom: -0.02, xTo: 0.02}},
        events: [
          {id: 'evt-fade', type: 'fade_in', targetId: 'depth-foreground', start: 0.4, duration: 0.8, easing: 'editorialOut', persist: true},
          {id: 'evt-shift', type: 'shift', targetId: 'depth-foreground', start: 1.4, duration: 5, easing: 'editorialInOut', persist: true, params: {dxRatio: -0.03}},
        ],
        finalHold: {start: 6.4, duration: 1.6},
      },
      layers: [
        {elementId: 'depth-foreground', asset: svgAsset('<circle cx="1280" cy="720" r="520" fill="#274c63"/><circle cx="1080" cy="600" r="140" fill="#f4f1ea"/>'), placement: {x: 0.3, y: 0.2, width: 0.4, height: 0.6, zIndex: 1}},
      ],
    },
  },
];
