import assert from 'node:assert/strict';
import test from 'node:test';
import {buildApp} from './server';

const boundary = 'editorial-motion-test-boundary';
const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function multipartRenderBody(prompt = 'Reveal the map') {
  const fields = [
    `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${prompt}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="durationSeconds"\r\n\r\n8\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="outputFileName"\r\n\r\nscene final.mp4\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="source.png"\r\nContent-Type: image/png\r\n\r\n`,
  ];
  return Buffer.concat([
    Buffer.from(fields.join('')),
    image,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

test('creates and retrieves a render job through the HTTP API', async (t) => {
  const app = await buildApp({logger: false});
  t.after(() => app.close());

  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/renders',
    headers: {'content-type': `multipart/form-data; boundary=${boundary}`},
    payload: multipartRenderBody(),
  });

  assert.equal(create.statusCode, 202);
  const created = create.json() as {jobId: string; status: string};
  assert.match(created.jobId, /^job_/);
  assert.equal(created.status, 'queued');

  const get = await app.inject({method: 'GET', url: `/api/v1/renders/${created.jobId}`});
  assert.equal(get.statusCode, 200);
  assert.equal(get.json().id, created.jobId);
  assert.equal(get.json().outputFileName, 'scene_final.mp4');
});

test('rejects a render request without an image', async (t) => {
  const app = await buildApp({logger: false});
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/renders',
    headers: {'content-type': `multipart/form-data; boundary=${boundary}`},
    payload: Buffer.from(`--${boundary}--\r\n`),
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, 'INVALID_INPUT');
});

test('returns not found for an unknown render job', async (t) => {
  const app = await buildApp({logger: false});
  t.after(() => app.close());

  const response = await app.inject({method: 'GET', url: '/api/v1/renders/job_missing'});

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().code, 'NOT_FOUND');
});
