import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';

export const EditorialScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {durationInFrames, fps} = useVideoConfig();
  const progress = interpolate(frame, [0, durationInFrames - 1], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const seconds = (frame / fps).toFixed(2);

  return (
    <AbsoluteFill style={{backgroundColor: '#111827', color: '#f9fafb', fontFamily: 'Arial, sans-serif', justifyContent: 'center', alignItems: 'center'}}>
      <div style={{textAlign: 'center'}}>
        <div style={{fontSize: 72, fontWeight: 700, letterSpacing: -2}}>editorial-motion</div>
        <div style={{fontSize: 30, color: '#93c5fd', marginTop: 24}}>deterministic renderer</div>
        <div style={{width: 700, height: 12, backgroundColor: '#374151', borderRadius: 6, marginTop: 48, overflow: 'hidden'}}>
          <div style={{width: `${progress * 100}%`, height: '100%', backgroundColor: '#60a5fa'}} />
        </div>
        <div style={{fontSize: 22, color: '#9ca3af', marginTop: 20}}>frame {frame} · {seconds}s</div>
      </div>
    </AbsoluteFill>
  );
};
