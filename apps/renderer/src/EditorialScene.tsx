import React from 'react';
import {AbsoluteFill, Img, staticFile} from 'remotion';
import {CameraTransform} from './components/CameraTransform';
import {SceneLayer} from './components/SceneLayer';
import type {SceneProps} from './scene-props';

const isUrl = (asset: string): boolean => /^(https?|data|file):/i.test(asset);

export const resolveAsset = (asset: string): string => (isUrl(asset) ? asset : staticFile(asset));

export const EditorialScene: React.FC<SceneProps> = ({plan, background, layers}) => (
  <CameraTransform camera={plan.camera} durationSeconds={plan.durationSeconds}>
    <AbsoluteFill>
      <Img src={resolveAsset(background)} style={{position: 'absolute', width: '100%', height: '100%', objectFit: 'fill'}} />
      {[...layers]
        .sort((a, b) => a.placement.zIndex - b.placement.zIndex)
        .map((layer) => (
          <SceneLayer
            key={layer.elementId}
            asset={resolveAsset(layer.asset)}
            placement={layer.placement}
            events={plan.events.filter((event) => event.targetId === layer.elementId)}
          />
        ))}
    </AbsoluteFill>
  </CameraTransform>
);
