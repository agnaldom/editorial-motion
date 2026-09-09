import type {SceneAnalysis} from '@editorial-motion/scene-schema';
import type {MotionPlannerInput, MotionPlannerProvider} from './motion-planner';
import type {SemanticVisionProvider} from './scene-analyzer';
import {imageSize} from './image-size';

// ponytail: deterministic doubles so the pipeline runs end-to-end without ML providers; replace via issues #54/#55.
export class DeterministicSceneAnalyzer implements SemanticVisionProvider {
  async analyze({image}: {image: Buffer; prompt: string}): Promise<unknown> {
    const {width, height} = imageSize(image);
    const analysis: SceneAnalysis = {
      version: '1',
      sceneId: 'scene01',
      source: {width, height, aspectRatio: width / height},
      compositionType: 'photo',
      elements: [{
        id: 'composition', label: 'Full composition', type: 'photo',
        bbox: {x: 0, y: 0, width: 1, height: 1},
        confidence: 1, zIndex: 1, animatable: true, protected: false,
        motionRole: 'primary', source: 'vision',
      }],
      protectedRegions: [],
    };
    return analysis;
  }
}

export class DeterministicMotionPlanner implements MotionPlannerProvider {
  async plan(input: MotionPlannerInput): Promise<unknown> {
    const canvas = input.canvas ?? {width: input.sceneAnalysis.source.width, height: input.sceneAnalysis.source.height};
    const targets = input.sceneAnalysis.elements.filter(
      (element) => element.animatable && !element.protected && element.motionRole !== 'static' && element.motionRole !== 'protected',
    );
    const events = targets.map((element, index) => ({
      id: `evt-${element.id}-drop`,
      type: 'drop' as const,
      targetId: element.id,
      start: 0.4 + index * 0.7,
      duration: 0.8,
      easing: 'editorialOut' as const,
      persist: true,
      params: {distanceRatio: 0.08, fade: true},
    }));
    const lastEnd = events.reduce((max, event) => Math.max(max, event.start + event.duration), 0);
    const holdStart = Math.min(lastEnd + 0.5, input.durationSeconds - 1.5);
    return {
      version: '1',
      sceneId: input.sceneAnalysis.sceneId,
      stylePreset: 'editorial-documentary',
      durationSeconds: input.durationSeconds,
      fps: input.fps,
      canvas,
      camera: {type: 'static'},
      events,
      finalHold: {start: holdStart, duration: input.durationSeconds - holdStart},
    };
  }
}
