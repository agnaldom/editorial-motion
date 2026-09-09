import React from 'react';
import {Composition} from 'remotion';
import {EditorialScene} from './EditorialScene';
import {sampleSceneProps} from './sample-scene';
import type {SceneProps} from './scene-props';

export const Root: React.FC = () => (
  <Composition
    id="EditorialScene"
    component={EditorialScene}
    durationInFrames={240}
    fps={30}
    width={2560}
    height={1440}
    defaultProps={sampleSceneProps}
    calculateMetadata={({props}) => ({
      durationInFrames: Math.max(1, Math.round(props.plan.durationSeconds * props.plan.fps)),
      fps: props.plan.fps,
      width: props.plan.canvas.width,
      height: props.plan.canvas.height,
    })}
  />
);
