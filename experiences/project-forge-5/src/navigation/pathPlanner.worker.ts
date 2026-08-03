/// <reference lib="webworker" />

import { planGridPath, type GridPlanRequest } from './gridPlanner';

type PlanMessage = {
  id: number;
  request: GridPlanRequest;
};

self.onmessage = (event: MessageEvent<PlanMessage>) => {
  const path = planGridPath(event.data.request);
  self.postMessage({ id: event.data.id, path });
};

export {};
