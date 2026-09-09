import assert from 'node:assert/strict';
import test from 'node:test';
import {chatCompletion, extractJson} from './llm';

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {status: 200, headers: {'content-type': 'application/json'}});

test('chatCompletion posts an OpenAI-compatible request and returns the completion text', async (t) => {
  const calls: Array<{url: string; init: RequestInit}> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({url: String(url), init});
    return jsonResponse({choices: [{message: {content: '{"ok": true}'}}]});
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const content = await chatCompletion('openai/gpt-4o', [{role: 'user', content: 'hi'}], {
    json: true,
    baseUrl: 'http://localhost:20128/v1',
    apiKey: 'omniroute-local',
  });

  assert.equal(content, '{"ok": true}');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://localhost:20128/v1/chat/completions');
  const body = JSON.parse(calls[0].init.body as string) as {model: string; messages: unknown[]; response_format: {type: string}};
  assert.equal(body.model, 'openai/gpt-4o');
  assert.equal(body.response_format.type, 'json_object');
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, 'Bearer omniroute-local');
});

test('chatCompletion raises a coded error when the gateway fails', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('rate limited', {status: 429});
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  await assert.rejects(
    () => chatCompletion('gemini/gemini-2.5-flash', [{role: 'user', content: 'hi'}], {baseUrl: 'http://localhost:20128/v1'}),
    (error: Error & {code?: string}) => error.code === 'LLM_REQUEST_FAILED',
  );
});

test('extractJson parses raw JSON or a JSON object embedded in prose', () => {
  assert.deepEqual(extractJson('{"a":1}'), {a: 1});
  assert.deepEqual(extractJson('Here is the plan:\n{"a":1}\nDone.'), {a: 1});
  assert.throws(() => extractJson('no json here'), /did not contain a JSON object/);
});
