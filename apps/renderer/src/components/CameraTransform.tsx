import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {MotionPlan} from '@editorial-motion/motion-schema';

type CameraTransformProps = {
  camera: MotionPlan['camera'];
  durationSeconds: number;
  children: React.ReactNode;
};

export const CameraTransform: React.FC<CameraTransformProps> = ({camera, durationSeconds, children}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const start = (camera.start ?? 0) * fps;
  const end = start + (camera.duration ?? durationSeconds) * fps;
  const progress = interpolate(frame, [start, end], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const params = camera.params ?? {};
  const lerp = (from: number | undefined, to: number | undefined): number =>
    (from ?? 0) + ((to ?? 0) - (from ?? 0)) * progress;
  const scale = camera.type === 'static' ? 1 : lerp(params.scaleFrom ?? 1, params.scaleTo ?? 1);
  const x = camera.type === 'static' ? 0 : lerp(params.xFrom, params.xTo);
  const y = camera.type === 'static' ? 0 : lerp(params.yFrom, params.yTo);

  return (
    <AbsoluteFill style={{transform: `translate(${x * width}px, ${y * height}px) scale(${scale})`}}>
      {children}
    </AbsoluteFill>
  );
};
