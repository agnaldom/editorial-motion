import {sceneAnalysisSchema, type SceneAnalysis} from '@editorial-motion/scene-schema';

export interface SemanticVisionProvider {
  analyze(input: {image: Buffer; prompt: string}): Promise<unknown>;
}

export class SceneAnalysisError extends Error {
  readonly code = 'SCENE_ANALYSIS_FAILED';

  constructor(message: string, options?: {cause?: unknown}) {
    super(message, options);
    this.name = 'SceneAnalysisError';
  }
}

export const analyzeScene = async (
  provider: SemanticVisionProvider,
  image: Buffer,
  prompt: string,
): Promise<SceneAnalysis> => {
  if (image.length === 0) throw new SceneAnalysisError('Image is required for semantic analysis');
  if (!prompt.trim()) throw new SceneAnalysisError('Motion prompt is required for semantic analysis');

  try {
    const result = await provider.analyze({image, prompt});
    return sceneAnalysisSchema.parse(result);
  } catch (error) {
    if (error instanceof SceneAnalysisError) throw error;
    throw new SceneAnalysisError('Provider returned an invalid scene analysis', {cause: error});
  }
};

export class DevelopmentSemanticProvider implements SemanticVisionProvider {
  async analyze(): Promise<unknown> {
    throw new SceneAnalysisError('No multimodal vision provider is configured');
  }
}
