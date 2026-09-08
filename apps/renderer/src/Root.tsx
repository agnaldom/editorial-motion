import React from 'react';
import {Composition} from 'remotion';
import {EditorialScene} from './EditorialScene';

export const Root: React.FC = () => (
  <Composition id="EditorialScene" component={EditorialScene} durationInFrames={240} fps={30} width={2560} height={1440} defaultProps={{}} />
);
