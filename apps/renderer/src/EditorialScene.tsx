import React from 'react';
import {AbsoluteFill, Img, staticFile} from 'remotion';
import {CameraTransform} from './components/CameraTransform';
import {SceneLayer} from './components/SceneLayer';
import {RouteReveal} from './components/RouteReveal';
import type {RoutePathPoints} from './components/RouteReveal';
import {GeneratedOverlay, isOverlayType} from './components/GeneratedOverlay';
import type {MotionEvent} from '@editorial-motion/motion-schema';
import type {SceneProps} from './scene-props';

const isUrl = (asset: string): boolean => /^(https?|data|file):/i.test(asset);

export const resolveAsset = (asset: string): string => (isUrl(asset) ? asset : staticFile(asset));

const asPathPoints = (raw: unknown): RoutePathPoints | undefined => {
  if (!Array.isArray(raw) || raw.length < 2) return undefined;
  const points: [number, number][] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length !== 2
      || typeof entry[0] !== 'number' || !Number.isFinite(entry[0])
      || typeof entry[1] !== 'number' || !Number.isFinite(entry[1])) return undefined;
    points.push([entry[0], entry[1]]);
  }
  return points;
};

// ponytail: path arbitrário vem de params.path do primeiro draw_path do layer (#64 faria o vectorizer)
const drawPathFromEvents = (events: readonly MotionEvent[]): RoutePathPoints | undefined => {
  const event = events.find((item) => item.type === 'draw_path');
  return event ? asPathPoints(event.params?.path) : undefined;
};

export const EditorialScene: React.FC<SceneProps> = ({plan, background, layers}) => (
  <CameraTransform camera={plan.camera} durationSeconds={plan.durationSeconds}>
    <AbsoluteFill>
      <Img src={resolveAsset(background)} style={{position: 'absolute', width: '100%', height: '100%', objectFit: 'fill'}} />
      {[...layers]
        .sort((a, b) => a.placement.zIndex - b.placement.zIndex)
        .map((layer) => {
          const layerEvents = plan.events.filter((event) => event.targetId === layer.elementId);
          const eventPath = drawPathFromEvents(layerEvents);
          const routePaths = layer.routePaths ?? (eventPath ? [eventPath] : undefined);
          return (
            <React.Fragment key={layer.elementId}>
              {routePaths ? (
                <RouteReveal
                  asset={resolveAsset(layer.asset)}
                  placement={layer.placement}
                  events={layerEvents}
                  paths={routePaths}
                />
              ) : (
                <SceneLayer
                  asset={resolveAsset(layer.asset)}
                  placement={layer.placement}
                  events={layerEvents}
                />
              )}
              {layerEvents.some((event) => isOverlayType(event.type)) ? (
                <GeneratedOverlay placement={layer.placement} events={layerEvents} />
              ) : null}
            </React.Fragment>
          );
        })}
    </AbsoluteFill>
  </CameraTransform>
);
