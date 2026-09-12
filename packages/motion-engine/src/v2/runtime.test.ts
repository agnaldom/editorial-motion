import assert from 'node:assert/strict';
import test from 'node:test';
import {animationV2Schema, type AnimationV2} from '@editorial-motion/motion-schema';
import {easingV2} from './easing';
import {animationProgress, easedProgress} from './evaluateTimeline';
import {evaluateElementAtFrame} from './evaluateElement';

const anim = (raw: unknown): AnimationV2 => animationV2Schema.parse(raw);

test('easings v2: endpoints, monotonicidade e overshoot do softSpring (§33)', () => {
  for (const name of ['linear', 'easeInOutCubic', 'easeOutCubic', 'easeOutQuart', 'easeInOutQuart', 'softSpring'] as const) {
    assert.equal(easingV2(name, 0), 0, `${name} em 0`);
    assert.ok(Math.abs(easingV2(name, 1) - 1) < 1e-9, `${name} em 1`);
  }
  assert.ok(easingV2('easeOutCubic', 0.5) > easingV2('linear', 0.5));
  let maxOvershoot = 0;
  for (let t = 0; t <= 1.0001; t += 0.001) {
    maxOvershoot = Math.max(maxOvershoot, easingV2('softSpring', t));
    if (t > 0.001) assert.ok(easingV2('easeOutQuart', t) >= easingV2('easeOutQuart', t - 0.001) - 1e-9, 'easeOutQuart monotônica');
  }
  assert.ok(maxOvershoot <= 1.02, `softSpring overshoot baixíssimo (got ${maxOvershoot})`);
  assert.ok(maxOvershoot > 1.0, 'softSpring tem micro-overshoot característico');
});

test('timeline: progresso saturado fora da janela', () => {
  const translate = anim({type: 'translate', startFrame: 10, endFrame: 20, from: {x: 0, y: 0}, to: {x: 0.05, y: 0}});
  assert.equal(animationProgress(translate, 0), 0);
  assert.equal(animationProgress(translate, 10), 0);
  assert.equal(animationProgress(translate, 15), 0.5);
  assert.equal(animationProgress(translate, 20), 1);
  assert.equal(animationProgress(translate, 99), 1);
  assert.equal(easedProgress(translate, 15), easingV2('easeOutCubic', 0.5));
});

test('translate compõe par/depth e respeita o limite editorial de 8% (§49)', () => {
  const move = anim({type: 'translate', startFrame: 0, endFrame: 10, from: {x: 0, y: 0}, to: {x: 0.05, y: -0.02}});
  const mid = evaluateElementAtFrame([move], 5);
  assert.ok(Math.abs(mid.translateX - 0.05 * easingV2('easeOutCubic', 0.5)) < 1e-9);
  const end = evaluateElementAtFrame([move], 10);
  assert.equal(end.translateX, 0.05);
  assert.equal(end.translateY, -0.02);

  const huge = anim({type: 'translate', startFrame: 0, endFrame: 10, from: {x: 0, y: 0}, to: {x: 0.5, y: -0.5}});
  const clamped = evaluateElementAtFrame([huge], 10);
  assert.equal(clamped.translateX, 0.08, 'deslocamento travado em 8% do canvas');
  assert.equal(clamped.translateY, -0.08);
});

test('separate/reassemble em par: sai e volta ao repouso', () => {
  const separate = anim({type: 'separate', startFrame: 10, endFrame: 30, offset: {x: 0.04, y: 0}});
  const reassemble = anim({type: 'reassemble', startFrame: 40, endFrame: 60});
  assert.equal(evaluateElementAtFrame([separate, reassemble], 0).translateX, 0);
  assert.equal(evaluateElementAtFrame([separate, reassemble], 30).translateX, 0.04);
  const back = evaluateElementAtFrame([separate, reassemble], 60);
  assert.ok(Math.abs(back.translateX) < 1e-9, 'reassemble retorna ao repouso');
});

test('unstack empilha e assenta por order/spread', () => {
  const unstack = anim({type: 'unstack', startFrame: 0, endFrame: 10, order: 2, spreadRatio: 0.03});
  assert.equal(evaluateElementAtFrame([unstack], 0).translateX, 0.06);
  assert.equal(evaluateElementAtFrame([unstack], 0).translateY, -0.06);
  assert.equal(evaluateElementAtFrame([unstack], 10).translateX, 0);
});

test('fade/reveal/paths/overlays avaliam por tipo', () => {
  const animations = [
    anim({type: 'fade', startFrame: 0, endFrame: 10, from: 0, to: 1}),
    anim({type: 'wipe_reveal', startFrame: 0, endFrame: 10, direction: 'right'}),
    anim({type: 'draw_path', connectorId: 'c1', startFrame: 10, endFrame: 20}),
    anim({type: 'highlight', startFrame: 20, endFrame: 30}),
    anim({type: 'underline', startFrame: 20, endFrame: 30}),
    anim({type: 'node_pop', startFrame: 30, endFrame: 40}),
  ];
  const start = evaluateElementAtFrame(animations, 0);
  assert.equal(start.opacity, 0, 'fade entrance começa escondido');
  assert.equal(start.reveal?.mode, 'wipe');
  assert.equal(start.reveal?.direction, 'right');
  assert.equal(start.pathProgresses.c1, 0);

  const midPath = evaluateElementAtFrame(animations, 15);
  assert.ok(Math.abs(midPath.pathProgresses.c1 - 0.5) < 1e-9);
  assert.equal(midPath.opacity, 1);

  const overlays = evaluateElementAtFrame(animations, 30);
  assert.equal(overlays.overlays.highlight, 1);
  assert.equal(overlays.overlays.underline, 1);
  const pop = evaluateElementAtFrame(animations, 35);
  assert.ok(pop.scale > 1 && pop.scale <= 1.06, 'node_pop com overshoot editorial mínimo');
});

test('track vazio devolve identidade', () => {
  assert.deepEqual(evaluateElementAtFrame([], 50), {
    translateX: 0, translateY: 0, scale: 1, rotationDeg: 0, opacity: 1,
    reveal: null, pathProgresses: {}, overlays: {},
  });
});
