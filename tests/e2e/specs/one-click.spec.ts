import {expect, test} from '@playwright/test';
import {setTimeout as delay} from 'node:timers/promises';

// A API não tem rota raiz (qualquer path devolve 404), e o webServer do
// Playwright só espera url com status 2xx/3xx/400-403 — então a readiness
// da API é feita aqui: 404 significa servidor no ar.
test.beforeAll(async () => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch('http://localhost:3000/api/v1/renders/nope');
      if (response.status === 404) return;
    } catch {
      // ainda não subiu
    }
    await delay(1000);
  }
  throw new Error('API did not start on :3000');
});

test('one-click flow: upload → prompt → generate → progress → download', async ({page}) => {
  await page.goto('/');

  await page.getByLabel(/upload image/i).setInputFiles('fixtures/test-image.png');
  await expect(page.getByText(/test-image\.png/)).toBeVisible();

  await page.getByRole('textbox', {name: /motion prompt/i}).fill('Static camera. Reveal the gradient from left to right.');
  await page.getByRole('button', {name: /generate animation/i}).click();

  await expect(page.getByText('Analyzing image')).toBeVisible();
  await expect(page.getByText('Rendering video')).toBeVisible({timeout: 60_000});

  // ponytail: render real em 2560x1440/8s leva ~1-2 min; upgrade: dims menores via env só para teste
  const downloadPromise = page.waitForEvent('download', {timeout: 240_000});
  await expect(page.getByRole('link', {name: /download/i})).toBeVisible({timeout: 240_000});
  const [download] = await Promise.all([downloadPromise, page.getByRole('link', {name: /download/i}).click()]);

  expect(download.suggestedFilename()).toBe('scene01.mp4');
  const path = await download.path();
  const {size} = await import('node:fs').then((fs) => fs.promises.stat(path));
  expect(size).toBeGreaterThan(0);
  const head = Buffer.alloc(12);
  const handle = await import('node:fs').then((fs) => fs.promises.open(path, 'r'));
  await handle.read(head, 0, 12, 0);
  await handle.close();
  expect(head.subarray(4, 8).toString('ascii')).toBe('ftyp');
});
