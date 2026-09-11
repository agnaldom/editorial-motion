import type {SemanticVisionProvider} from './scene-analyzer';
import {DeterministicSceneAnalyzer} from './doubles';

/**
 * Analisador heurístico via vision-service (issue #119): sem LLM e com
 * VISION_SERVICE_URL configurado, delega a decomposição em regiões salientes
 * ao endpoint /v1/scene/analyze (CPU-only). Serviço indisponível ou resposta
 * inválida degrada para o double de elemento único, preservando o pipeline.
 */
export class VisionServiceSceneAnalyzer implements SemanticVisionProvider {
  private readonly fallback = new DeterministicSceneAnalyzer();

  constructor(private readonly baseUrl: string | undefined = process.env.VISION_SERVICE_URL) {}

  async analyze(input: {image: Buffer; prompt: string}): Promise<unknown> {
    if (!this.baseUrl) return this.fallback.analyze(input);
    try {
      const form = new FormData();
      form.append('image', new Blob([new Uint8Array(input.image)]), 'source.png');
      const response = await fetch(new URL('/v1/scene/analyze', this.baseUrl), {method: 'POST', body: form});
      if (!response.ok) throw new Error(`vision-service respondeu ${response.status}`);
      return await response.json();
    } catch {
      // ponytail: serviço fora do ar degrada para 1 elemento em vez de derrubar o job
      return this.fallback.analyze(input);
    }
  }
}
