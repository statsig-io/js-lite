export type EvaluationDetails = {
  time: number;
  reason: EvaluationReason;
};

export enum EvaluationReason {
  Network = 'Network',
  Bootstrap = 'Bootstrap',
  InvalidBootstrap = 'InvalidBootstrap',
  Cache = 'Cache',
  Prefetch = 'Prefetch',
  Sticky = 'Sticky',
  Unrecognized = 'Unrecognized',
  Uninitialized = 'Uninitialized',
  Error = 'Error',
  NetworkNotModified = 'NetworkNotModified',
}
