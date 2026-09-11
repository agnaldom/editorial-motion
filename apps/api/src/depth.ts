import type {MotionPlan} from '@editorial-motion/motion-schema';
import type {SceneElement} from '@editorial-motion/scene-schema';

export const DEPTH_FOREGROUND_ID = 'depth-foreground';

export type ForegroundSaliency = {
  mask: Buffer;
  bbox: {x: number; y: number; width: number; height: number};
  coverage: number;
};

/** Máscara de foreground saliente do vision-service; indisponível → null (degrada sem derrubar o job). */
export const fetchForegroundSaliency = async (image: Buffer, baseUrl: string | undefined): Promise<ForegroundSaliency | null> => {
  if (!baseUrl) return null;
  try {
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(image)]), 'source.png');
    const response = await fetch(new URL('/v1/saliency/foreground', baseUrl), {method: 'POST', body: form});
    if (!response.ok) throw new Error(`vision-service respondeu ${response.status}`);
    const metadata = JSON.parse(response.headers.get('x-saliency-metadata') ?? 'null') as {bbox: ForegroundSaliency['bbox']; coverage: number} | null;
    if (!metadata) throw new Error('metadata de saliência ausente');
    return {mask: Buffer.from(await response.arrayBuffer()), bbox: metadata.bbox, coverage: metadata.coverage};
  } catch {
    return null;
  }
};

/** Recorte RGBA do foreground via /v1/layers/extract; falha → null. */
export const extractForegroundLayer = async (image: Buffer, mask: Buffer, baseUrl: string): Promise<Buffer | null> => {
  try {
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(image)]), 'source.png');
    form.append('mask', new Blob([new Uint8Array(mask)]), 'mask.png');
    form.append('element_id', DEPTH_FOREGROUND_ID);
    const response = await fetch(new URL('/v1/layers/extract', baseUrl), {method: 'POST', body: form});
    if (!response.ok) throw new Error(`vision-service respondeu ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
};

export const depthForegroundElement = (bbox: ForegroundSaliency['bbox']): SceneElement => ({
  id: DEPTH_FOREGROUND_ID,
  label: 'Salient foreground',
  type: 'cutout',
  bbox,
  confidence: 0.7,
  zIndex: 1,
  animatable: true,
  protected: false,
  motionRole: 'primary',
  source: 'derived',
});

/**
 * Motion gráfico editorial por padrão (issue #121): pan mínimo de câmera + shift do
 * foreground em direção oposta — o parallax vem do contraste relativo entre os planos,
 * não de zoom na imagem inteira. Limites: pan 4% (≤5%), shift 3% do canvas.
 */
export const applyDepthMotion = (plan: MotionPlan): MotionPlan => ({
  ...plan,
  camera: {type: 'subtle_pan', start: 0, duration: plan.durationSeconds, params: {xFrom: -0.02, xTo: 0.02}},
  events: [
    {id: 'evt-depth-fade', type: 'fade_in', targetId: DEPTH_FOREGROUND_ID, start: 0.4, duration: 0.8, easing: 'editorialOut', persist: true},
    {
      id: 'evt-depth-shift',
      type: 'shift',
      targetId: DEPTH_FOREGROUND_ID,
      start: 1.4,
      duration: Number((plan.durationSeconds - 2.9).toFixed(2)),
      easing: 'editorialInOut',
      persist: true,
      params: {dxRatio: -0.03},
    },
  ],
  finalHold: {start: Number((plan.durationSeconds - 1.6).toFixed(2)), duration: 1.6},
});
