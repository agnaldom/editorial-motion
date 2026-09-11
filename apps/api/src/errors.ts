// Catálogo de erros do SPEC §18 — códigos estáveis entre API, pipeline e jobs.
export const errorCodes = [
  'INVALID_INPUT',
  'UNSUPPORTED_IMAGE',
  'IMAGE_TOO_LARGE',
  'PROMPT_EMPTY',
  'SCENE_ANALYSIS_FAILED',
  'NO_ANIMATABLE_ELEMENTS',
  'DETECTION_FAILED',
  'SEGMENTATION_FAILED',
  'SEGMENTATION_LOW_CONFIDENCE',
  'BACKGROUND_RECONSTRUCTION_FAILED',
  'MOTION_PLAN_FAILED',
  'MOTION_PLAN_INVALID',
  'RENDER_FAILED',
  'OUTPUT_VALIDATION_FAILED',
  'TIMEOUT',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof errorCodes)[number];

// HTTP status coerente por código (erros de input viram 4xx específicos).
export const httpStatusFor: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  PROMPT_EMPTY: 400,
  UNSUPPORTED_IMAGE: 415,
  IMAGE_TOO_LARGE: 413,
  SCENE_ANALYSIS_FAILED: 502,
  NO_ANIMATABLE_ELEMENTS: 422,
  DETECTION_FAILED: 502,
  SEGMENTATION_FAILED: 502,
  SEGMENTATION_LOW_CONFIDENCE: 422,
  BACKGROUND_RECONSTRUCTION_FAILED: 502,
  MOTION_PLAN_FAILED: 502,
  MOTION_PLAN_INVALID: 422,
  RENDER_FAILED: 502,
  OUTPUT_VALIDATION_FAILED: 500,
  TIMEOUT: 504,
  INTERNAL_ERROR: 500,
};

// Erros determinísticos nunca são re-tentados (SPEC §26: "Never retry deterministic validation errors").
export const nonRetryableCodes = new Set<string>([
  'INVALID_INPUT',
  'UNSUPPORTED_IMAGE',
  'IMAGE_TOO_LARGE',
  'PROMPT_EMPTY',
  'MOTION_PLAN_INVALID',
  'NO_ANIMATABLE_ELEMENTS',
  'OUTPUT_VALIDATION_FAILED',
  'CANCELLED',
]);

export class CodedError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'CodedError';
    this.code = code;
  }
}

export const codeOf = (error: unknown): string | undefined =>
  error instanceof Error ? (error as unknown as {code?: unknown}).code as string | undefined : undefined;
