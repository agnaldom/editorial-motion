import assert from 'node:assert/strict';
import test from 'node:test';
import {VisionServiceClient} from './vision-client';
import {encodePng, solidMaskPng} from './png';

const jsonResponse = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {headers: {'content-type': 'application/json'}, ...init});

const stubFetch = (t: test.TestContext, handler: (url: string, init?: RequestInit) => Promise<Response> | Response) => {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
};

test('capabilities marca development/copy como false e layers como true', async (t) => {
  stubFetch(t, async (url) => {
    assert.match(url, /\/health$/);
    return jsonResponse({service: 'vision-service', provider: 'development-null/development-null/development-copy/skeleton', status: 'ok'});
  });
  const client = new VisionServiceClient('http://vision.local');
  assert.deepEqual(await client.capabilities(), {detect: false, segment: false, inpaint: false, layers: true});
});

test('capabilities deriva providers reais do health', async (t) => {
  stubFetch(t, async () => jsonResponse({service: 'vision-service', provider: 'groundingdino/sam2/lama+diffusers/skeleton', status: 'ok'}));
  const client = new VisionServiceClient('http://vision.local');
  assert.deepEqual(await client.capabilities(), {detect: true, segment: true, inpaint: true, layers: true});
});

test('capabilities retorna null quando o serviço está indisponível', async (t) => {
  stubFetch(t, async () => {
    throw new Error('connection refused');
  });
  const client = new VisionServiceClient('http://vision.local');
  assert.equal(await client.capabilities(), null);
});

test('detect envia labels como JSON e valida a resposta', async (t) => {
  stubFetch(t, async (url, init) => {
    assert.match(url, /\/v1\/detect$/);
    assert.equal(init?.method, 'POST');
    const body = init?.body as FormData;
    assert.equal(body.get('labels'), JSON.stringify(['map', 'route']));
    assert.ok(body.get('image') instanceof Blob);
    return jsonResponse({detections: [{label: 'map', confidence: 0.9, bbox: {x: 0.1, y: 0.2, width: 0.3, height: 0.4}}]});
  });
  const client = new VisionServiceClient('http://vision.local');
  const detections = await client.detect(solidMaskPng(4, 4), ['map', 'route']);
  assert.equal(detections.length, 1);
  assert.equal(detections[0].bbox.width, 0.3);
});

test('segment decodifica mask_png_b64 e descarta itens sem bytes', async (t) => {
  const maskPng = encodePng(4, 4, Buffer.alloc(4 * 4 * 4, 200));
  stubFetch(t, async (url, init) => {
    assert.match(url, /\/v1\/segment$/);
    const body = init?.body as FormData;
    assert.equal(typeof body.get('detections'), 'string');
    return jsonResponse({
      masks: [
        {label: 'map', confidence: 0.8, width: 4, height: 4, mask_ref: 'masks/0.png', mask_png_b64: maskPng.toString('base64')},
        {label: 'route', confidence: 0.7, width: 4, height: 4, mask_ref: 'masks/1.png'},
      ],
    });
  });
  const client = new VisionServiceClient('http://vision.local');
  const masks = await client.segment(solidMaskPng(4, 4), [{label: 'map', confidence: 0.9, bbox: {x: 0, y: 0, width: 1, height: 1}}]);
  assert.equal(masks.length, 1);
  assert.deepEqual(masks[0].maskPng, maskPng);
});

test('inpaint envia mask + additional_masks e devolve os bytes', async (t) => {
  const clean = encodePng(4, 4, Buffer.alloc(4 * 4 * 4, 42));
  stubFetch(t, async (url, init) => {
    assert.match(url, /\/v1\/inpaint$/);
    const body = init?.body as FormData;
    assert.ok(body.get('image') instanceof Blob);
    assert.ok(body.get('mask') instanceof Blob);
    assert.equal(body.getAll('additional_masks').length, 2);
    return new Response(new Uint8Array(clean), {headers: {'content-type': 'image/png'}});
  });
  const client = new VisionServiceClient('http://vision.local');
  const result = await client.inpaint(solidMaskPng(4, 4), [solidMaskPng(4, 4), solidMaskPng(4, 4), solidMaskPng(4, 4)]);
  assert.deepEqual(result, clean);
});

test('extractLayer lê X-Layer-Metadata e devolve o PNG RGBA', async (t) => {
  const layer = encodePng(4, 4, Buffer.alloc(4 * 4 * 4, 255));
  stubFetch(t, async (url, init) => {
    assert.match(url, /\/v1\/layers\/extract$/);
    const body = init?.body as FormData;
    assert.equal(body.get('element_id'), 'det_map');
    assert.equal(body.get('z_index'), '3');
    return new Response(new Uint8Array(layer), {
      headers: {'content-type': 'image/png', 'x-layer-metadata': JSON.stringify({element_id: 'det_map', bbox: {x: 0.25, y: 0.25, width: 0.5, height: 0.5}, z_index: 3})},
    });
  });
  const client = new VisionServiceClient('http://vision.local');
  const extracted = await client.extractLayer(solidMaskPng(4, 4), solidMaskPng(4, 4), {
    elementId: 'det_map', label: 'Map', zIndex: 3, maskRef: 'masks/det_map.png', layerRef: 'layers/det_map.png',
  });
  assert.deepEqual(extracted.layer, layer);
  assert.deepEqual(extracted.metadata.bbox, {x: 0.25, y: 0.25, width: 0.5, height: 0.5});
});

test('erros HTTP lançam Error com code', async (t) => {
  stubFetch(t, async (url) => {
    if (url.includes('/health')) return jsonResponse({service: 'vision-service', provider: 'groundingdino/sam2/lama/skeleton', status: 'ok'});
    return jsonResponse({detail: 'boom'}, {status: 500});
  });
  const client = new VisionServiceClient('http://vision.local');
  await assert.rejects(() => client.detect(solidMaskPng(4, 4), ['map']), (error: Error & {code?: string}) => error.code === 'VISION_DETECT_FAILED');
  await assert.rejects(() => client.segment(solidMaskPng(4, 4), []), (error: Error & {code?: string}) => error.code === 'VISION_SEGMENT_FAILED');
  await assert.rejects(
    () => client.extractLayer(solidMaskPng(4, 4), solidMaskPng(4, 4), {elementId: 'e', label: 'E', zIndex: 1, maskRef: 'm', layerRef: 'l'}),
    (error: Error & {code?: string}) => error.code === 'VISION_EXTRACT_FAILED',
  );
  await assert.rejects(() => client.inpaint(solidMaskPng(4, 4), []), (error: Error & {code?: string}) => error.code === 'VISION_INPAINT_FAILED');
});
