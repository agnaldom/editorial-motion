import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {MotionEvent} from '@editorial-motion/motion-schema';
import {easing} from '@editorial-motion/motion-engine';
import type {SceneLayerPlacement} from './SceneLayer';

export type OverlayType = 'highlight' | 'circle_emphasis' | 'underline';

export const isOverlayType = (type: string): type is OverlayType =>
  type === 'highlight' || type === 'circle_emphasis' || type === 'underline';

type GeneratedOverlayProps = {
  placement: SceneLayerPlacement;
  events: readonly MotionEvent[];
};

/** Allowed generated overlays (SPEC §8 stage 8): circle, highlight, underline. Never text. */
export const GeneratedOverlay: React.FC<GeneratedOverlayProps> = ({placement, events}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const left = placement.x * width;
  const top = placement.y * height;
  const boxW = placement.width * width;
  const boxH = placement.height * height;

  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {events.map((event) => {
        if (!isOverlayType(event.type)) return null;
        const startFrame = event.start * fps;
        const endFrame = (event.start + event.duration) * fps;
        const linear = interpolate(frame, [startFrame, endFrame], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        const progress = event.persist === false && frame > endFrame ? 0 : easing(event.easing, linear);
        const zIndex = placement.zIndex + 1000;
        const key = event.id;
        if (event.type === 'highlight') {
          return (
            <div
              key={key}
              style={{
                position: 'absolute',
                left,
                top,
                width: boxW,
                height: boxH,
                backgroundColor: `rgba(250, 204, 21, ${0.35 * progress})`,
                zIndex,
              }}
            />
          );
        }
        if (event.type === 'underline') {
          const y = top + boxH;
          return (
            <svg key={key} width={width} height={height} style={{position: 'absolute', inset: 0, zIndex}}>
              <path d={`M ${left} ${y} L ${left + boxW} ${y}`} pathLength={1} fill="none" stroke="#f59e0b"
                strokeWidth={Math.max(3, boxH * 0.02)} strokeDasharray={1} strokeDashoffset={1 - progress} />
            </svg>
          );
        }
        const rx = (boxW / 2) * (0.9 + 0.1 * progress);
        const ry = (boxH / 2) * (0.9 + 0.1 * progress);
        const cx = left + boxW / 2;
        const cy = top + boxH / 2;
        const ellipse = `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy}`;
        return (
          <svg key={key} width={width} height={height} style={{position: 'absolute', inset: 0, zIndex}}>
            <path d={ellipse} pathLength={1} fill="none" stroke="#f59e0b" strokeWidth={Math.max(3, boxH * 0.015)}
              strokeDasharray={1} strokeDashoffset={1 - progress} opacity={progress} />
          </svg>
        );
      })}
    </AbsoluteFill>
  );
};
