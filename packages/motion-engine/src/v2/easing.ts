// SPEC V2 §33 (issue #146): easing restrita do editorial-documentary. softSpring é
// mola subamortecida com amortecimento 0.9 (overshoot baixíssimo, sem cara de app).

export type EasingV2Name = 'linear' | 'easeInOutCubic' | 'easeOutCubic' | 'easeOutQuart' | 'easeInOutQuart' | 'softSpring';

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export const easingV2 = (name: EasingV2Name, progress: number): number => {
  const t = clamp01(progress);
  if (name === 'linear') return t;
  if (name === 'easeOutCubic') return 1 - (1 - t) ** 3;
  if (name === 'easeInOutCubic') return t < 0.5 ? 4 * t ** 3 : 1 - ((-2 * t + 2) ** 3) / 2;
  if (name === 'easeOutQuart') return 1 - (1 - t) ** 4;
  if (name === 'easeInOutQuart') return t < 0.5 ? 8 * t ** 4 : 1 - ((-2 * t + 2) ** 4) / 2;
  // softSpring: resposta ao degrau subamortecida (ζ=0.8, ω=6) — overshoot ~0.3%,
  // amortecimento alto, sem cara de app. Normalizada para terminar exatamente em 1.
  const zeta = 0.8;
  const omega = 6;
  const wd = omega * Math.sqrt(1 - zeta ** 2);
  const raw = (time: number): number =>
    1 - Math.exp(-zeta * omega * time) * (Math.cos(wd * time) + (zeta * omega / wd) * Math.sin(wd * time));
  return Math.max(0, raw(t) / raw(1));
};
