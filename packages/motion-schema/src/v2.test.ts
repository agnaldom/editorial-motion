import assert from 'node:assert/strict';
import test from 'node:test';
import {
  expandStaggers,
  motionPlanV2Schema,
  staggerRank,
  trackV2Schema,
  type MotionPlanV2,
  type TrackV2,
} from './v2';

const translate = (startFrame: number, endFrame: number) => ({
  type: 'translate' as const,
  startFrame,
  endFrame,
  from: {x: 0, y: 0},
  to: {x: -48, y: -16},
});

const plan = (tracks: unknown[], extra: Record<string, unknown> = {}): unknown => ({
  version: '2',
  meta: {durationFrames: 240, fps: 30, width: 2560, height: 1440, preset: 'editorial-documentary'},
  strategy: {name: 'disassemble-reassemble', qualityLevel: 3},
  tracks,
  ...extra,
});

test('motionPlanV2Schema valida o exemplo do §28', () => {
  const parsed = motionPlanV2Schema.parse(plan([
    {
      target: 'element-01',
      animations: [
        translate(34, 74),
        {type: 'rotate', startFrame: 34, endFrame: 74, from: 0, to: -1.5},
        {type: 'reassemble', startFrame: 82, endFrame: 112},
      ],
    },
  ]));
  assert.equal(parsed.version, '2');
  assert.equal(parsed.strategy.qualityLevel, 3);
  assert.equal(parsed.tracks[0].animations.length, 3);
});

test('conectores §29: bezier com from/to/style validam; referência exige id', () => {
  const parsed = motionPlanV2Schema.parse(plan([
    {target: 'a', animations: [{type: 'draw_path', connectorId: 'connector-01', startFrame: 10, endFrame: 50}]},
  ], {
    connectors: [{id: 'connector-01', type: 'bezier', from: {x: 0.18, y: 0.52}, to: {x: 0.63, y: 0.48}, style: {strokeWidth: 2.5, stroke: '#C7A55B'}}],
  }));
  assert.equal(parsed.connectors[0].style.stroke, '#C7A55B');
  assert.throws(() => motionPlanV2Schema.parse(plan([
    {target: 'a', animations: [{type: 'draw_path', connectorId: 'c', startFrame: 10, endFrame: 50}]},
  ], {connectors: [{id: 'outro', type: 'line', from: {x: 0, y: 0}, to: {x: 1, y: 1}, style: {strokeWidth: 1, stroke: '#000'}}]})), /Unknown connectorId/);
});

test('timing inválido rejeita: endFrame <= startFrame', () => {
  assert.throws(() => trackV2Schema.parse({target: 'a', animations: [translate(50, 50)]}), /endFrame/);
  assert.throws(() => trackV2Schema.parse({target: 'a', animations: [translate(60, 30)]}), /endFrame/);
});

test('easings restritas do §33; draw_path é linear', () => {
  assert.throws(() => trackV2Schema.parse({target: 'a', animations: [{...translate(0, 10), easing: 'bounce'}]}), /Invalid/);
  const draw = trackV2Schema.parse({target: 'a', animations: [{type: 'draw_path', connectorId: 'c', startFrame: 0, endFrame: 10}]});
  assert.equal(draw.animations[0].type === 'draw_path' && draw.animations[0].easing, 'linear');
});

const staggeredTracks = (): TrackV2[] => [
  {target: 'left', stagger: {order: 'left-to-right', frames: 4}, animations: [translate(0, 10)]},
  {target: 'mid', stagger: {order: 'left-to-right', frames: 4}, animations: [translate(0, 10)]},
  {target: 'right', stagger: {order: 'left-to-right', frames: 4}, animations: [translate(0, 10)]},
];

test('stagger §26 expande starts por ordem espacial (left-to-right)', () => {
  const positions: Record<string, {x: number; y: number}> = {
    left: {x: 0.2, y: 0.5},
    mid: {x: 0.5, y: 0.5},
    right: {x: 0.8, y: 0.5},
  };
  const expanded = expandStaggers(staggeredTracks(), (target) => positions[target]);
  const starts = expanded.map((track) => (track.animations[0] as {startFrame: number}).startFrame);
  assert.deepEqual(starts, [0, 4, 8]);
});

test('stagger center-out ordena por distância ao centro', () => {
  const tracks: TrackV2[] = [
    {target: 'far', stagger: {order: 'center-out', frames: 2}, animations: [translate(0, 10)]},
    {target: 'near', stagger: {order: 'center-out', frames: 2}, animations: [translate(0, 10)]},
  ];
  const positions: Record<string, {x: number; y: number}> = {
    far: {x: 0.1, y: 0.1},
    near: {x: 0.5, y: 0.55},
  };
  const expanded = expandStaggers(tracks, (target) => positions[target]);
  const byTarget = Object.fromEntries(expanded.map((track) => [track.target, (track.animations[0] as {startFrame: number}).startFrame]));
  assert.equal(byTarget.near, 0);
  assert.equal(byTarget.far, 2);
});

test('random-seeded é determinístico por posição', () => {
  const rankA = staggerRank('random-seeded', {x: 0.3, y: 0.7}, 1, 5);
  const rankB = staggerRank('random-seeded', {x: 0.3, y: 0.7}, 1, 5);
  assert.equal(rankA, rankB);
  assert.ok(rankA >= 0 && rankA < 5);
});

test('track sem stagger não é deslocado', () => {
  const tracks: TrackV2[] = [{target: 'solo', animations: [translate(20, 30)]}];
  const expanded = expandStaggers(tracks, () => ({x: 0, y: 0}));
  assert.deepEqual(expanded, tracks);
});

test('stagger saliency-order ordena por saliência descendente', () => {
  const tracks: TrackV2[] = [
    {target: 'weak', stagger: {order: 'saliency-order', frames: 3}, animations: [translate(0, 10)]},
    {target: 'strong', stagger: {order: 'saliency-order', frames: 3}, animations: [translate(0, 10)]},
  ];
  const expanded = expandStaggers(tracks, (target) => ({x: 0.5, y: 0.5, saliency: target === 'strong' ? 0.9 : 0.2}));
  const byTarget = Object.fromEntries(expanded.map((track) => [track.target, (track.animations[0] as {startFrame: number}).startFrame]));
  assert.equal(byTarget.strong, 0);
  assert.equal(byTarget.weak, 3);
});
