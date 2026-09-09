export type ChatContent = string | Array<
  {type: 'text'; text: string} | {type: 'image_url'; image_url: {url: string}}
>;

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: ChatContent;
};

export type ChatOptions = {
  json?: boolean;
  timeoutMs?: number;
  baseUrl?: string;
  apiKey?: string;
};

const codedError = (code: string, message: string): Error => Object.assign(new Error(message), {code});

export const chatCompletion = async (
  model: string,
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<string> => {
  const baseUrl = (options.baseUrl ?? process.env.OMNIROUTE_BASE_URL ?? 'http://localhost:20128/v1').replace(/\/$/, '');
  const apiKey = options.apiKey ?? process.env.OMNIROUTE_API_KEY ?? 'omniroute-local';
  const timeoutMs = options.timeoutMs ?? Number(process.env.LLM_TIMEOUT_MS ?? 120_000);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {'content-type': 'application/json', authorization: `Bearer ${apiKey}`},
      // ponytail: json_object mode is honored by OpenAI/Anthropic/Gemini via OmniRoute; repair loop covers providers that ignore it.
      body: JSON.stringify({model, messages, ...(options.json ? {response_format: {type: 'json_object'}} : {})}),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw codedError('LLM_REQUEST_FAILED', `Could not reach LLM gateway at ${baseUrl}: ${error instanceof Error ? error.message : error}`);
  }

  if (!response.ok) {
    throw codedError('LLM_REQUEST_FAILED', `LLM gateway responded ${response.status}: ${(await response.text().catch(() => '')).slice(0, 300)}`);
  }
  const payload = await response.json() as {choices?: Array<{message?: {content?: string}}>};
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw codedError('LLM_EMPTY_RESPONSE', 'LLM gateway returned an empty completion');
  }
  return content;
};

export const extractJson = (content: string): unknown => {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // fall through to brace extraction
  }
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) throw codedError('LLM_EMPTY_RESPONSE', 'LLM response did not contain a JSON object');
  return JSON.parse(match[0]) as unknown;
};
