import React from 'react';
import {Img, useCurrentFrame, useVideoConfig} from 'remotion';
import {resolveLayerState} from '@editorial-motion/motion-engine';
import type {MotionEvent} from '@editorial-motion/motion-schema';
import type {SceneLayerPlacement} from './SceneLayer';

export type RoutePathPoints = ReadonlyArray<readonly [number, number]>;

/** Normalized points (0..1 of the layer box) -> SVG path data in layer-local pixels. */
export const routePathData = (points: RoutePathPoints, boxWidth: number, boxHeight: number): string =>
  points
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${(x * boxWidth).toFixed(2)} ${(y * boxHeight).toFixed(2)}`)
    .join(' ');

type RouteRevealProps = {
  asset: string;
  placement: SceneLayerPlacement;
  events: readonly MotionEvent[];
  paths: readonly RoutePathPoints[];
};

/** Route raster revealed by an animated SVG path mask (SPEC §14.3 / §15.3, draw_path/draw_arrow). */
export const RouteReveal: React.FC<RouteRevealProps> = ({asset, placement, events, paths}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const state = resolveLayerState(frame, fps, events);
  const anchorX = placement.anchorX ?? 0.5;
  const anchorY = placement.anchorY ?? 0.5;
  const left = placement.x * width;
  const top = placement.y * height;
  const boxW = placement.width * width;
  const boxH = placement.height * height;
  const maskId = React.useId().replace(/:/g, '');
  // ponytail: stroke fixo de 2% da menor dimensão; a largura real da rota viria do vectorizer (#64)
  const strokeWidth = Math.max(4, Math.min(boxW, boxH) * 0.02);

  return (
    <>
      <Img
        src={asset}
        style={{
          position: 'absolute',
          left,
          top,
          width: boxW,
          height: boxH,
          zIndex: placement.zIndex,
          opacity: state.opacity,
          objectFit: 'fill',
          transformOrigin: `${anchorX * 100}% ${anchorY * 100}%`,
          transform: `translate(${state.translateX * width}px, ${state.translateY * height}px) scale(${state.scale})`,
          mask: `url(#${maskId})`,
          WebkitMask: `url(#${maskId})`,
        }}
      />
      <svg width={boxW} height={boxH} style={{position: 'absolute', left, top}}>
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x={0} y={0} width={boxW} height={boxH}>
            {paths.map((points, index) => (
              <path
                key={index}
                d={routePathData(points, boxW, boxH)}
                pathLength={1}
                fill="none"
                stroke="#fff"
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={1}
                strokeDashoffset={1 - state.revealProgress}
              />
            ))}
          </mask>
        </defs>
      </svg>
    </>
  );
};
