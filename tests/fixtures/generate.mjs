// Deterministic generator for the V1 fixture scenes (SPEC §33/§38).
// Synthetic editorial-style scenes with known ground truth: every shape drawn
// here is a manifest target. No randomness beyond fixed-seed PRNG; running
// this script reproduces byte-identical PNGs.
// Usage: node tests/fixtures/generate.mjs
import {deflateSync} from 'node:zlib';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const WIDTH = 1280;
const HEIGHT = 720;

const PAPER = [246, 242, 233];
const PAPER_DARK = [232, 226, 212];
const INK = [34, 37, 42];
const MUTED = [138, 133, 120];
const RED = [200, 68, 44];
const BLUE = [46, 94, 140];
const GREEN = [84, 130, 80];

// PNG encoder — mirrors apps/api/src/png.ts (RGBA8, filter 0 per scanline).
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xFFFFFFFF;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};
const chunk = (type, data) => {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
};
const encodePng = (width, height, rgba) => {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row += 1) rgba.copy(raw, row * stride + 1, row * width * 4, (row + 1) * width * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, {level: 9})),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const mulberry32 = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

class Canvas {
  constructor(background = PAPER) {
    this.data = Buffer.alloc(WIDTH * HEIGHT * 4);
    this.rect(0, 0, WIDTH, HEIGHT, background);
  }
  set(x, y, color) {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
    const offset = (y * WIDTH + x) * 4;
    this.data[offset] = color[0];
    this.data[offset + 1] = color[1];
    this.data[offset + 2] = color[2];
    this.data[offset + 3] = color[3] ?? 255;
  }
  rect(x, y, w, h, color) {
    for (let py = Math.max(0, y); py < Math.min(HEIGHT, y + h); py += 1) {
      for (let px = Math.max(0, x); px < Math.min(WIDTH, x + w); px += 1) this.set(px, py, color);
    }
  }
  circle(cx, cy, radius, color) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx * dx + dy * dy <= radius * radius) this.set(cx + dx, cy + dy, color);
      }
    }
  }
  poly(points, color) {
    for (let y = 0; y < HEIGHT; y += 1) {
      const xs = [];
      for (let i = 0; i < points.length; i += 1) {
        const [x1, y1] = points[i];
        const [x2, y2] = points[(i + 1) % points.length];
        if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        for (let x = Math.ceil(xs[i]); x <= Math.floor(xs[i + 1]); x += 1) this.set(x, y, color);
      }
    }
  }
  line(x0, y0, x1, y1, thickness, color) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i += 1) {
      this.circle(Math.round(x0 + ((x1 - x0) * i) / steps), Math.round(y0 + ((y1 - y0) * i) / steps), Math.max(1, Math.round(thickness / 2)), color);
    }
  }
  dashedLine(x0, y0, x1, y1, thickness, color, dash = 14, gap = 10) {
    const length = Math.hypot(x1 - x0, y1 - y0);
    const ux = (x1 - x0) / length;
    const uy = (y1 - y0) / length;
    for (let d = 0; d < length; d += dash + gap) {
      this.line(x0 + ux * d, y0 + uy * d, x0 + ux * Math.min(d + dash, length), y0 + uy * Math.min(d + dash, length), thickness, color);
    }
  }
  // simulated typography: an ink bar, since no font rendering is available
  textBar(x, y, w, h, color = INK) {
    this.rect(x, y, w, h, color);
  }
}

const blob = (rng, cx, cy, radius, vertices) => {
  const points = [];
  for (let i = 0; i < vertices; i += 1) {
    const angle = (i / vertices) * Math.PI * 2;
    const r = radius * (0.7 + rng() * 0.5);
    points.push([Math.round(cx + Math.cos(angle) * r), Math.round(cy + Math.sin(angle) * r * 0.8)]);
  }
  return points;
};

const scenes = {
  'editorial-map-three-countries': () => {
    const rng = mulberry32(101);
    const canvas = new Canvas();
    canvas.rect(60, 40, 700, 640, PAPER_DARK);
    const countries = [
      {poly: blob(rng, 260, 220, 120, 7), color: BLUE},
      {poly: blob(rng, 480, 300, 110, 6), color: GREEN},
      {poly: blob(rng, 330, 460, 130, 8), color: RED},
    ];
    for (const country of countries) canvas.poly(country.poly, country.color);
    for (const [index, country] of countries.entries()) {
      const [cx, cy] = country.poly[0];
      canvas.dashedLine(cx, cy, 860 + index * 90, 120 + index * 180, 5, INK);
      canvas.circle(860 + index * 90, 120 + index * 180, 10, INK);
    }
    canvas.textBar(880, 40, 340, 42, INK); // headline
    canvas.rect(880, 560, 340, 100, PAPER_DARK); // numerical zones
    canvas.rect(896, 576, 120, 16, MUTED);
    canvas.rect(896, 612, 180, 16, MUTED);
    return canvas;
  },
  'paper-collage-people-documents': () => {
    const rng = mulberry32(202);
    const canvas = new Canvas();
    for (let i = 0; i < 3; i += 1) {
      const x = 80 + i * 240;
      canvas.rect(x, 120 + (i % 2) * 40, 200, 280, [255, 255, 255]);
      canvas.rect(x + 16, 140 + (i % 2) * 40, 168, 10, MUTED);
      canvas.rect(x + 16, 164 + (i % 2) * 40, 120, 10, MUTED);
      canvas.rect(x + 16, 188 + (i % 2) * 40, 150, 10, MUTED);
    }
    for (let i = 0; i < 2; i += 1) {
      const cx = 900 + i * 160;
      const cy = 300 + i * 60;
      canvas.circle(cx, cy - 70, 42, [232 - i * 30, 196 - i * 20, 160 - i * 10]); // head
      canvas.poly(blob(rng, cx, cy + 90, 110, 7), [BLUE, GREEN][i]); // body
    }
    canvas.textBar(80, 620, 500, 24, MUTED); // caption
    return canvas;
  },
  'diagram-nodes-arrows': () => {
    const canvas = new Canvas();
    const center = [640, 360];
    const satellites = [[300, 160], [980, 160], [300, 560], [980, 560], [640, 120], [640, 600]];
    canvas.circle(center[0], center[1], 70, RED);
    for (const [x, y] of satellites) {
      canvas.circle(x, y, 46, BLUE);
      const dx = center[0] - x;
      const dy = center[1] - y;
      const length = Math.hypot(dx, dy);
      canvas.line(x + (dx / length) * 52, y + (dy / length) * 52, center[0] - (dx / length) * 76, center[1] - (dy / length) * 76, 6, INK);
      canvas.poly([[center[0] - (dx / length) * 60, center[1] - (dy / length) * 60], [center[0] - (dx / length) * 84, center[1] - (dy / length) * 82], [center[0] - (dx / length) * 92, center[1] - (dy / length) * 58]], INK);
    }
    return canvas;
  },
  'financial-chart': () => {
    const rng = mulberry32(404);
    const canvas = new Canvas();
    canvas.rect(120, 80, 1040, 520, [255, 255, 255]);
    canvas.line(160, 560, 160, 120, 4, INK);
    canvas.line(160, 560, 1120, 560, 4, INK);
    let px = 200;
    let py = 480;
    const points = [];
    while (px < 1060) {
      points.push([px, py]);
      px += 90;
      py = Math.max(140, Math.min(520, py - 40 + Math.round(rng() * 90)));
    }
    for (let i = 0; i + 1 < points.length; i += 1) canvas.line(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], 5, BLUE);
    const last = points[points.length - 1];
    canvas.circle(last[0], last[1], 16, RED); // final data point
    canvas.circle(last[0], last[1], 26, RED);
    canvas.textBar(120, 20, 400, 36, INK); // headline
    canvas.rect(880, 20, 280, 40, PAPER_DARK); // legend
    canvas.rect(896, 32, 40, 16, BLUE);
    canvas.rect(960, 32, 120, 16, MUTED);
    return canvas;
  },
  'historical-timeline': () => {
    const canvas = new Canvas();
    canvas.textBar(80, 40, 520, 44, INK); // title
    canvas.line(100, 400, 1180, 400, 6, INK);
    for (let i = 0; i < 5; i += 1) {
      const x = 160 + i * 240;
      canvas.circle(x, 400, 18, RED);
      canvas.rect(x - 60, 300 - (i % 2) * 160, 120, 70, PAPER_DARK);
      canvas.rect(x - 44, 316 - (i % 2) * 160, 88, 10, MUTED);
      canvas.rect(x - 44, 338 - (i % 2) * 160, 60, 10, MUTED);
    }
    return canvas;
  },
  'map-route-lines': () => {
    const rng = mulberry32(606);
    const canvas = new Canvas();
    canvas.rect(40, 40, 900, 640, PAPER_DARK);
    canvas.poly(blob(rng, 300, 250, 170, 8), [214, 208, 190]);
    canvas.poly(blob(rng, 620, 480, 150, 7), [214, 208, 190]);
    const routes = [
      [[200, 180], [420, 260], [560, 200], [760, 320]],
      [[260, 520], [460, 460], [640, 560], [820, 480]],
    ];
    for (const route of routes) {
      for (let i = 0; i + 1 < route.length; i += 1) canvas.line(route[i][0], route[i][1], route[i + 1][0], route[i + 1][1], 6, RED);
      for (const [x, y] of route) canvas.circle(x, y, 9, INK);
    }
    for (let i = 0; i < 4; i += 1) canvas.textBar(980, 80 + i * 80, 220, 22, MUTED); // labels
    return canvas;
  },
  'protected-statistic-boxes': () => {
    const rng = mulberry32(707);
    const canvas = new Canvas();
    canvas.poly(blob(rng, 400, 360, 240, 9), GREEN); // illustration
    canvas.circle(340, 300, 60, PAPER);
    canvas.rect(300, 380, 200, 24, INK);
    for (let i = 0; i < 3; i += 1) {
      const x = 820;
      const y = 80 + i * 200;
      canvas.rect(x, y, 380, 160, [255, 255, 255]);
      canvas.rect(x, y, 380, 8, INK);
      canvas.textBar(x + 24, y + 40, 200, 30, INK);
      canvas.rect(x + 24, y + 96, 300, 12, MUTED);
    }
    return canvas;
  },
  'headline-text-composition': () => {
    const canvas = new Canvas();
    canvas.textBar(140, 120, 1000, 90, INK); // headline
    canvas.textBar(240, 240, 800, 30, MUTED); // subtitle
    canvas.circle(220, 460, 80, RED);
    canvas.rect(420, 400, 220, 140, BLUE);
    canvas.poly([[720, 540], [860, 400], [1000, 540]], GREEN);
    return canvas;
  },
  'overlapping-paper-layers': () => {
    const canvas = new Canvas();
    const layers = [
      {x: 200, y: 140, w: 520, h: 360, color: [255, 252, 244]},
      {x: 420, y: 220, w: 520, h: 360, color: [240, 234, 218]},
      {x: 320, y: 320, w: 520, h: 300, color: [226, 218, 198]},
    ];
    for (const [index, layer] of layers.entries()) {
      canvas.rect(layer.x + 8, layer.y + 10, layer.w, layer.h, [200, 194, 178]); // drop shadow
      canvas.rect(layer.x, layer.y, layer.w, layer.h, layer.color);
      canvas.rect(layer.x + 24, layer.y + 24, layer.w - 48, 14, [BLUE, RED, GREEN][index]);
      canvas.rect(layer.x + 24, layer.y + 56, layer.w - 96, 10, MUTED);
      canvas.rect(layer.x + 24, layer.y + 80, layer.w - 72, 10, MUTED);
    }
    return canvas;
  },
  'difficult-low-confidence-scene': () => {
    const rng = mulberry32(909);
    const canvas = new Canvas();
    // ambiguous object: low-contrast blob nearly blending into the background
    canvas.poly(blob(rng, 620, 360, 200, 10), [226, 222, 210]);
    canvas.poly(blob(rng, 640, 380, 150, 9), [234, 230, 219]);
    canvas.rect(80, 80, 1120, 60, PAPER_DARK); // text band
    canvas.rect(100, 100, 700, 20, MUTED);
    canvas.rect(100, 600, 400, 16, MUTED);
    return canvas;
  },
};

const fixturesDir = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(fixturesDir, 'manifest.json'), 'utf8'));
for (const fixture of manifest.fixtures) {
  const build = scenes[fixture.id];
  if (!build) throw new Error(`no scene builder for fixture: ${fixture.id}`);
  writeFileSync(path.join(fixturesDir, fixture.source), encodePng(WIDTH, HEIGHT, build().data));
  console.log(`generated ${fixture.source}`);
}
