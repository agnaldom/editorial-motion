import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {MotionEvent} from '@editorial-motion/motion-schema';
import {easing} from '@editorial-motion/motion-engine';
import type {SceneLayerPlacement} from './SceneLayer';

type ConnectEvent = MotionEvent & {type: 'connect'};

export const isConnectEvent = (event: MotionEvent): event is ConnectEvent => event.type === 'connect';

type ConnectOverlayProps = {
  events: readonly MotionEvent[];
  // Resolve a posição do alvo pelo elementId (layer placement em repouso).
  placementOf: (elementId: string) => SceneLayerPlacement | undefined;
};

/**
 * connect (§5.4, issue #126): desenho progressivo da conexão entre dois alvos —
 * line + arrowhead do centro de `targetId` ao centro de `params.to`, com
 * stroke-dashoffset como as rotas. Cross-layer via params, sem revisão de DSL.
 */
export const ConnectOverlay: React.FC<ConnectOverlayProps> = ({events, placementOf}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();

  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {events.filter(isConnectEvent).map((event) => {
        const from = placementOf(event.targetId);
        const to = placementOf(event.params?.to as string);
        if (!from || !to) return null;
        const startFrame = event.start * fps;
        const endFrame = (event.start + event.duration) * fps;
        const linear = interpolate(frame, [startFrame, endFrame], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
        const progress = event.persist === false && frame > endFrame ? 0 : easing(event.easing, linear);
        const x1 = (from.x + from.width / 2) * width;
        const y1 = (from.y + from.height / 2) * height;
        const x2 = (to.x + to.width / 2) * width;
        const y2 = (to.y + to.height / 2) * height;
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const headLength = Math.max(10, Math.min(width, height) * 0.015);
        const hx = x2 - Math.cos(angle) * headLength;
        const hy = y2 - Math.sin(angle) * headLength;
        const zIndex = Math.max(from.zIndex, to.zIndex) + 1000;
        const strokeWidth = Math.max(3, Math.min(width, height) * 0.006);
        return (
          <svg key={event.id} width={width} height={height} style={{position: 'absolute', inset: 0, zIndex}}>
            <path
              d={`M ${x1} ${y1} L ${hx} ${hy}`}
              pathLength={1}
              fill="none"
              stroke="#c9a227"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={1}
              strokeDashoffset={1 - progress}
            />
            <path
              d={`M ${x2} ${y2} L ${x2 - headLength * 1.6 * Math.cos(angle - 0.5)} ${y2 - headLength * 1.6 * Math.sin(angle - 0.5)} L ${x2 - headLength * 1.6 * Math.cos(angle + 0.5)} ${y2 - headLength * 1.6 * Math.sin(angle + 0.5)} Z`}
              fill="#c9a227"
              opacity={progress}
            />
          </svg>
        );
      })}
    </AbsoluteFill>
  );
};
