import type {SceneProps} from './scene-props';

const svgAsset = (body: string): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2560 1440">${body}</svg>`)}`;

export const sampleSceneProps: SceneProps = {
  background: svgAsset('<rect width="2560" height="1440" fill="#f4f1ea"/><rect x="120" y="120" width="2320" height="1200" fill="#e2ddd2"/>'),
  plan: {
    version: '1',
    sceneId: 'sample',
    stylePreset: 'editorial-documentary',
    durationSeconds: 8,
    fps: 30,
    canvas: {width: 2560, height: 1440},
    camera: {type: 'static'},
    events: [
      {id: 'evt-backdrop-fade', type: 'fade_in', targetId: 'backdrop', start: 0.4, duration: 0.8, easing: 'editorialOut', persist: true},
      {id: 'evt-marker-drop', type: 'drop', targetId: 'marker', start: 1.6, duration: 0.8, easing: 'editorialOut', persist: true, params: {distanceRatio: 0.08, fade: true}},
    ],
    finalHold: {start: 3, duration: 5},
  },
  layers: [
    {
      elementId: 'backdrop',
      asset: svgAsset('<circle cx="1280" cy="720" r="520" fill="#274c63"/>'),
      placement: {x: 0.2, y: 0.1, width: 0.6, height: 0.8, anchorX: 0.5, anchorY: 0.5, zIndex: 1},
    },
    {
      elementId: 'marker',
      asset: svgAsset('<rect width="512" height="320" rx="24" fill="#c05621"/><rect x="40" y="200" width="432" height="40" rx="8" fill="#f4f1ea"/>'),
      placement: {x: 0.4, y: 0.35, width: 0.2, height: 0.25, anchorX: 0.5, anchorY: 0.5, zIndex: 2},
    },
  ],
};
