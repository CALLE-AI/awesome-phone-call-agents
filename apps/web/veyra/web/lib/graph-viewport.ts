export const MIN_GRAPH_ZOOM = 0.45;
export const MAX_GRAPH_ZOOM = 2.25;

export type GraphViewport = {
  x: number;
  y: number;
  scale: number;
};

export type GraphPoint = {
  x: number;
  y: number;
};

export function clampGraphZoom(scale: number): number {
  return Math.min(MAX_GRAPH_ZOOM, Math.max(MIN_GRAPH_ZOOM, scale));
}

/** Change scale while keeping the same graph coordinate beneath the screen anchor. */
export function zoomGraphAt(
  viewport: GraphViewport,
  requestedScale: number,
  anchor: GraphPoint,
): GraphViewport {
  const scale = clampGraphZoom(requestedScale);
  const ratio = scale / viewport.scale;
  return {
    x: anchor.x - (anchor.x - viewport.x) * ratio,
    y: anchor.y - (anchor.y - viewport.y) * ratio,
    scale,
  };
}
