export type AxiomGraspStage =
  'approach' | 'align' | 'close' | 'secure' | 'lift' | 'hold' | 'open' | 'retract';

export type AxiomGraspMotion = Readonly<{
  stage: AxiomGraspStage;
  reach: number;
  handClosure: number;
  lift: number;
  attachReady: boolean;
}>;

const smoothstep = (start: number, end: number, value: number): number => {
  const t = Math.max(0, Math.min(1, (value - start) / Math.max(1e-6, end - start)));
  return t * t * (3 - 2 * t);
};

export function resolveAxiomGraspMotion(phase: number, releasing = false): AxiomGraspMotion {
  const normalized = Number.isFinite(phase) ? Math.max(0, Math.min(1, phase)) : 0;
  if (releasing) {
    return {
      stage: normalized < 0.45 ? 'open' : 'retract',
      reach: 1 - smoothstep(0.48, 1, normalized),
      handClosure: 1 - smoothstep(0.08, 0.42, normalized),
      lift: 1 - smoothstep(0.05, 0.5, normalized),
      attachReady: false,
    };
  }

  const reach =
    normalized < 0.28
      ? smoothstep(0, 0.28, normalized) * 0.74
      : normalized < 0.46
        ? 0.74 + smoothstep(0.28, 0.46, normalized) * 0.26
        : normalized < 0.94
          ? 1
          : 1 - smoothstep(0.94, 1, normalized) * 0.08;
  return {
    stage:
      normalized < 0.28
        ? 'approach'
        : normalized < 0.46
          ? 'align'
          : normalized < 0.62
            ? 'close'
            : normalized < 0.72
              ? 'secure'
              : normalized < 0.92
                ? 'lift'
                : 'hold',
    reach,
    handClosure: smoothstep(0.46, 0.62, normalized),
    lift: smoothstep(0.7, 0.92, normalized),
    attachReady: normalized >= 0.62,
  };
}
