import {renderMetrics} from './observability';

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

type ChatCompletionPayload = {
  choices?: Array<{message?: {content?: string}; delta?: {content?: string}}>;
  usage?: {prompt_tokens?: number; completion_tokens?: number};
};

// Gateways compatíveis com OpenAI respondem JSON; alguns (ex.: OmniRoute) emitem SSE mesmo com
// stream=false. Tolerância nos dois formatos (issue #138).
export const readChatCompletionPayload = async (response: Response): Promise<ChatCompletionPayload> => {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) {
    const text = await response.text();
    let content = '';
    let usage: {prompt_tokens?: number; completion_tokens?: number} | undefined;
    for (const line of text.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let chunk: ChatCompletionPayload;
      try {
        chunk = JSON.parse(data) as ChatCompletionPayload;
      } catch {
        continue;
      }
      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') content += delta;
      if (chunk.usage) usage = chunk.usage;
    }
    if (!content) throw codedError('LLM_EMPTY_RESPONSE', 'LLM gateway streamed an empty completion');
    return {choices: [{message: {content}}], ...(usage ? {usage} : {})};
  }
  try {
    return await response.json() as ChatCompletionPayload;
  } catch (error) {
    throw codedError('LLM_REQUEST_FAILED', `LLM gateway returned a non-JSON response: ${error instanceof Error ? error.message : error}`);
  }
};

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
      // ponytail: json_object mode é honrado por OpenAI/Anthropic/Gemini via OmniRoute; repair loop cobra
      // providers que ignoram. stream:false é pedido explicito — alguns gateways (ex.: OmniRoute) fazem
      // SSE por padrão; mesmo assim o parser abaixo tolera resposta SSE (issue #138).
      body: JSON.stringify({model, messages, stream: false, ...(options.json ? {response_format: {type: 'json_object'}} : {})}),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw codedError('LLM_REQUEST_FAILED', `Could not reach LLM gateway at ${baseUrl}: ${error instanceof Error ? error.message : error}`);
  }

  if (!response.ok) {
    throw codedError('LLM_REQUEST_FAILED', `LLM gateway responded ${response.status}: ${(await response.text().catch(() => '')).slice(0, 300)}`);
  }
  const payload = await readChatCompletionPayload(response);
  const usage = payload.usage;
  if (usage && (typeof usage.prompt_tokens === 'number' || typeof usage.completion_tokens === 'number')) {
    renderMetrics.recordLlmTokens(usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0);
  }
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
