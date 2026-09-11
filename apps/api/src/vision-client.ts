import {z} from 'zod';

export type VisionCapabilities = {detect: boolean; segment: boolean; inpaint: boolean; layers: boolean};

export type VisionBBox = {x: number; y: number; width: number; height: number};

export type VisionDetection = {label: string; confidence: number; bbox: VisionBBox};

export type VisionSegmentMask = {label: string; confidence: number; maskPng: Buffer};

const normalizedBoxSchema = z.object({x: z.number(), y: z.number(), width: z.number(), height: z.number()});

const detectResponseSchema = z.object({
  detections: z.array(z.object({label: z.string(), confidence: z.number(), bbox: normalizedBoxSchema})),
});

const segmentResponseSchema = z.object({
  masks: z.array(z.object({
    label: z.string(),
    confidence: z.number(),
    mask_png_b64: z.string().optional(),
  })),
});

const layerMetadataSchema = z.object({bbox: normalizedBoxSchema});

const codedError = (code: string, message: string): Error => Object.assign(new Error(message), {code});

const pngBlob = (bytes: Buffer): Blob => new Blob([new Uint8Array(bytes)], {type: 'image/png'});

// Cliente mínimo do vision-service (apps/vision-service) usando fetch nativo (Node 20).
// Erros lançados carregam `code` VISION_*; os stages fazem catch → fallback sem ML.
export class VisionServiceClient {
  private capabilitiesCache: VisionCapabilities | null | undefined;

  constructor(private readonly baseUrl: string) {}

  private url(pathname: string): string {
    return new URL(pathname, this.baseUrl).toString();
  }

  // null = serviço indisponível; resultado cached em memória por instância.
  async capabilities(): Promise<VisionCapabilities | null> {
    if (this.capabilitiesCache !== undefined) return this.capabilitiesCache;
    try {
      const response = await fetch(this.url('/health'), {signal: AbortSignal.timeout(10_000)});
      if (!response.ok) throw codedError('VISION_UNAVAILABLE', `vision-service health responded ${response.status}`);
      const body = (await response.json()) as {provider?: string};
      // Contrato /health: provider "det/seg/inp/vec" com os nomes dos providers instanciados.
      const [detector = '', segmenter = '', inpainter = ''] = String(body.provider ?? '').split('/');
      const isReal = (name: string) => !name.startsWith('development') && name !== 'copy';
      this.capabilitiesCache = {
        detect: isReal(detector),
        segment: isReal(segmenter),
        inpaint: isReal(inpainter),
        // extract é CPU (refinamento + recorte RGBA); basta o serviço responder.
        layers: true,
      };
    } catch {
      this.capabilitiesCache = null;
    }
    return this.capabilitiesCache;
  }

  async detect(image: Buffer, labels: string[]): Promise<VisionDetection[]> {
    const form = new FormData();
    form.append('image', pngBlob(image), 'image.png');
    form.append('labels', JSON.stringify(labels));
    const response = await fetch(this.url('/v1/detect'), {method: 'POST', body: form, signal: AbortSignal.timeout(60_000)});
    if (!response.ok) throw codedError('VISION_DETECT_FAILED', `vision-service /v1/detect responded ${response.status}`);
    return detectResponseSchema.parse(await response.json()).detections;
  }

  async segment(image: Buffer, detections: VisionDetection[]): Promise<VisionSegmentMask[]> {
    const form = new FormData();
    form.append('image', pngBlob(image), 'image.png');
    form.append('detections', JSON.stringify(detections));
    const response = await fetch(this.url('/v1/segment'), {method: 'POST', body: form, signal: AbortSignal.timeout(60_000)});
    if (!response.ok) throw codedError('VISION_SEGMENT_FAILED', `vision-service /v1/segment responded ${response.status}`);
    return segmentResponseSchema.parse(await response.json()).masks
      // ponytail: o contrato ainda permite mask só server-side (mask_ref); sem b64 não há
      // bytes para persistir, então o item é descartado e o elemento cai no solidMaskPng.
      .filter((mask) => typeof mask.mask_png_b64 === 'string')
      .map((mask) => ({label: mask.label, confidence: mask.confidence, maskPng: Buffer.from(mask.mask_png_b64 as string, 'base64')}));
  }

  async inpaint(image: Buffer, masks: Buffer[]): Promise<Buffer> {
    if (masks.length === 0) throw codedError('VISION_INPAINT_FAILED', 'at least one mask is required');
    const form = new FormData();
    form.append('image', pngBlob(image), 'image.png');
    form.append('mask', pngBlob(masks[0]), 'mask.png');
    for (const additional of masks.slice(1)) {
      form.append('additional_masks', pngBlob(additional), 'mask.png');
    }
    const response = await fetch(this.url('/v1/inpaint'), {method: 'POST', body: form, signal: AbortSignal.timeout(60_000)});
    if (!response.ok) throw codedError('VISION_INPAINT_FAILED', `vision-service /v1/inpaint responded ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  async extractLayer(
    image: Buffer,
    mask: Buffer,
    options: {elementId: string; label: string; zIndex: number; maskRef: string; layerRef: string},
  ): Promise<{layer: Buffer; metadata: {bbox: VisionBBox}}> {
    const form = new FormData();
    form.append('image', pngBlob(image), 'image.png');
    form.append('mask', pngBlob(mask), 'mask.png');
    form.append('element_id', options.elementId);
    form.append('label', options.label);
    form.append('z_index', String(options.zIndex));
    form.append('mask_ref', options.maskRef);
    form.append('layer_ref', options.layerRef);
    const response = await fetch(this.url('/v1/layers/extract'), {method: 'POST', body: form, signal: AbortSignal.timeout(60_000)});
    if (!response.ok) throw codedError('VISION_EXTRACT_FAILED', `vision-service /v1/layers/extract responded ${response.status}`);
    const metadataHeader = response.headers.get('x-layer-metadata');
    const metadata = layerMetadataSchema.parse(metadataHeader ? JSON.parse(metadataHeader) : {bbox: {x: 0, y: 0, width: 1, height: 1}});
    return {layer: Buffer.from(await response.arrayBuffer()), metadata};
  }
}
