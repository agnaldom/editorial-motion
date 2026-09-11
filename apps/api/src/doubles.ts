import type {SceneAnalysis} from '@editorial-motion/scene-schema';
import type {MotionPlannerInput, MotionPlannerProvider} from './motion-planner';
import type {SemanticVisionProvider} from './scene-analyzer';
import {imageSize} from './image-size';
import {paramsForGesture, gesturesForPrompt, primaryGestureForPrompt} from './motion-vocabulary';

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
    // Stagger como primitive: starts sequenciais 0.4 + index * 0.7 compõem o ritmo editorial.
    const events = targets.map((element, index) => {
      const type = primaryGestureForPrompt(input.prompt, element);
      const params = paramsForGesture(type);
      return {
        id: `evt-${element.id}-${type}`,
        type,
        targetId: element.id,
        start: 0.4 + index * 0.7,
        duration: 0.8,
        easing: 'editorialOut' as const,
        persist: true,
        ...(params ? {params} : {}),
      };
    });
    // Overlay de ênfase: hint highlight/underline vira evento adicional no primeiro
    // alvo primário, depois que a entrada dele termina (GeneratedOverlay o desenha).
    const matchedTypes = gesturesForPrompt(input.prompt).flatMap((hint) => hint.types);
    const overlayType = ['highlight', 'circle_emphasis', 'underline'].find((type) => matchedTypes.includes(type));
    const primary = targets.find((element) => element.motionRole === 'primary');
    if (overlayType && primary) {
      const entranceEnd = 0.4 + targets.indexOf(primary) * 0.7 + 0.8;
      events.push({
        id: `evt-${primary.id}-${overlayType}`,
        type: overlayType,
        targetId: primary.id,
        start: Number((entranceEnd + 0.2).toFixed(2)),
        duration: 1.2,
        easing: 'editorialOut' as const,
        persist: true,
      });
    }
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
