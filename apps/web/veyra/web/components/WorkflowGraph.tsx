"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  clampGraphZoom,
  type GraphPoint,
  type GraphViewport,
  zoomGraphAt,
} from "@/lib/graph-viewport";
import { NODE_CHROME, NODE_H, NODE_W } from "@/lib/node-style";
import type { WorkflowEdge, WorkflowNode } from "@/types/workflow";

/** Orthogonal route from a's exit to b's entry, matching the design's three cases. */
function edgePath(a: WorkflowNode, b: WorkflowNode): string {
  const ax = a.x + NODE_W / 2;
  const bx = b.x + NODE_W / 2;

  // Straight drop when b sits directly below a.
  if (b.y > a.y + NODE_H - 10 && Math.abs(ax - bx) < 6) {
    return `M${ax},${a.y + NODE_H} L${bx},${b.y - 6}`;
  }
  // Down, across, down — b is lower and not to the right.
  if (b.y > a.y + NODE_H - 10 && b.x <= a.x + NODE_W) {
    const my = (a.y + NODE_H + b.y) / 2;
    return `M${ax},${a.y + NODE_H} L${ax},${my} L${bx},${my} L${bx},${b.y - 6}`;
  }
  // Out the right side, across, into b's left edge.
  const mx = (a.x + NODE_W + b.x) / 2;
  return `M${a.x + NODE_W},${a.y + NODE_H / 2} L${mx},${a.y + NODE_H / 2} L${mx},${
    b.y + NODE_H / 2
  } L${b.x - 6},${b.y + NODE_H / 2}`;
}

/** Where a branch condition chip sits along its edge. */
function edgeMidpoint(a: WorkflowNode, b: WorkflowNode) {
  if (b.x > a.x + NODE_W) {
    return {
      x: (a.x + NODE_W + b.x) / 2,
      y: (a.y + NODE_H / 2 + b.y + NODE_H / 2) / 2,
    };
  }
  return { x: a.x + NODE_W / 2, y: (a.y + NODE_H + b.y) / 2 };
}

interface WorkflowGraphProps {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMoveNode: (id: string, x: number, y: number) => void;
}

type TouchGesture =
  | {
      kind: "pan";
      startPoint: GraphPoint;
      startViewport: GraphViewport;
    }
  | {
      kind: "node";
      nodeId: string;
      nodeX: number;
      nodeY: number;
      startPoint: GraphPoint;
      scale: number;
    }
  | {
      kind: "pinch";
      startDistance: number;
      startMidpoint: GraphPoint;
      startViewport: GraphViewport;
    };

type SafariGestureEvent = Event & {
  clientX: number;
  clientY: number;
  scale: number;
};

const INITIAL_VIEWPORT: GraphViewport = { x: 0, y: 0, scale: 1 };

export default function WorkflowGraph({
  nodes,
  edges,
  selectedId,
  onSelect,
  onMoveNode,
}: WorkflowGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const touchGesture = useRef<TouchGesture | null>(null);
  const viewportRef = useRef<GraphViewport>(INITIAL_VIEWPORT);
  const [viewport, setViewportState] = useState<GraphViewport>(INITIAL_VIEWPORT);
  const [dragging, setDragging] = useState(false);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const setViewport = (next: GraphViewport) => {
    viewportRef.current = next;
    setViewportState(next);
  };

  const localPoint = (clientX: number, clientY: number): GraphPoint => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };

  const touchPoint = (touch: React.Touch): GraphPoint =>
    localPoint(touch.clientX, touch.clientY);

  const touchMidpoint = (touches: React.TouchList): GraphPoint => {
    const first = touchPoint(touches[0]);
    const second = touchPoint(touches[1]);
    return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  };

  const touchDistance = (touches: React.TouchList): number => {
    const first = touchPoint(touches[0]);
    const second = touchPoint(touches[1]);
    return Math.hypot(second.x - first.x, second.y - first.y);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const isInsideGraph = (clientX: number, clientY: number) => {
      const rect = container.getBoundingClientRect();
      return (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      );
    };

    // Chromium exposes trackpad pinch as Ctrl+wheel. Capture it at window level so
    // the browser cannot begin page zoom before the event reaches the graph element.
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !isInsideGraph(event.clientX, event.clientY)) return;
      event.preventDefault();

      const rect = container.getBoundingClientRect();
      const current = viewportRef.current;
      const next = zoomGraphAt(
        current,
        current.scale * Math.exp(-event.deltaY * 0.01),
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
      );
      viewportRef.current = next;
      setViewportState(next);
    };

    let safariPinch: { anchor: GraphPoint; viewport: GraphViewport } | null = null;

    // Safari uses non-standard gesture events for trackpad pinch instead of
    // Ctrl+wheel. Keep these native and non-passive for the same reason.
    const handleGestureStart = (rawEvent: Event) => {
      const event = rawEvent as SafariGestureEvent;
      if (!isInsideGraph(event.clientX, event.clientY)) return;
      event.preventDefault();

      const rect = container.getBoundingClientRect();
      safariPinch = {
        anchor: { x: event.clientX - rect.left, y: event.clientY - rect.top },
        viewport: viewportRef.current,
      };
      setDragging(true);
    };

    const handleGestureChange = (rawEvent: Event) => {
      if (!safariPinch) return;
      const event = rawEvent as SafariGestureEvent;
      event.preventDefault();

      const next = zoomGraphAt(
        safariPinch.viewport,
        safariPinch.viewport.scale * event.scale,
        safariPinch.anchor,
      );
      viewportRef.current = next;
      setViewportState(next);
    };

    const handleGestureEnd = (event: Event) => {
      if (!safariPinch) return;
      event.preventDefault();
      safariPinch = null;
      setDragging(false);
    };

    window.addEventListener("wheel", handleWheel, { passive: false, capture: true });
    window.addEventListener("gesturestart", handleGestureStart, {
      passive: false,
      capture: true,
    });
    window.addEventListener("gesturechange", handleGestureChange, {
      passive: false,
      capture: true,
    });
    window.addEventListener("gestureend", handleGestureEnd, {
      passive: false,
      capture: true,
    });

    return () => {
      window.removeEventListener("wheel", handleWheel, true);
      window.removeEventListener("gesturestart", handleGestureStart, true);
      window.removeEventListener("gesturechange", handleGestureChange, true);
      window.removeEventListener("gestureend", handleGestureEnd, true);
    };
  }, []);

  /** Runs `move` on pointermove until pointerup, wherever the pointer goes. */
  const trackPointer = (move: (e: PointerEvent) => void) => {
    setDragging(true);
    const up = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const onCanvasDown = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    const sx = e.clientX;
    const sy = e.clientY;
    const start = viewportRef.current;
    trackPointer((ev) =>
      setViewport({
        ...start,
        x: start.x + (ev.clientX - sx),
        y: start.y + (ev.clientY - sy),
      }),
    );
  };

  const onNodeDown = (e: React.PointerEvent, node: WorkflowNode) => {
    if (e.pointerType === "touch") return;
    e.stopPropagation();
    onSelect(node.id);
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = node.x;
    const oy = node.y;
    const scale = viewportRef.current.scale;
    trackPointer((ev) =>
      onMoveNode(
        node.id,
        ox + (ev.clientX - sx) / scale,
        oy + (ev.clientY - sy) / scale,
      ),
    );
  };

  const beginTouchGesture = (touches: React.TouchList, target: EventTarget | null) => {
    if (touches.length >= 2) {
      touchGesture.current = {
        kind: "pinch",
        startDistance: Math.max(touchDistance(touches), 1),
        startMidpoint: touchMidpoint(touches),
        startViewport: viewportRef.current,
      };
      setDragging(true);
      return;
    }
    if (touches.length !== 1) return;

    const point = touchPoint(touches[0]);
    const nodeElement = target instanceof Element
      ? target.closest<HTMLElement>("[data-workflow-node-id]")
      : null;
    const node = nodeElement ? byId.get(nodeElement.dataset.workflowNodeId ?? "") : null;
    if (node) {
      onSelect(node.id);
      touchGesture.current = {
        kind: "node",
        nodeId: node.id,
        nodeX: node.x,
        nodeY: node.y,
        startPoint: point,
        scale: viewportRef.current.scale,
      };
    } else {
      touchGesture.current = {
        kind: "pan",
        startPoint: point,
        startViewport: viewportRef.current,
      };
    }
    setDragging(true);
  };

  const onTouchStart = (event: React.TouchEvent) => {
    event.preventDefault();
    beginTouchGesture(event.touches, event.target);
  };

  const onTouchMove = (event: React.TouchEvent) => {
    event.preventDefault();
    const gesture = touchGesture.current;
    if (!gesture) return;

    if (event.touches.length >= 2 && gesture.kind === "pinch") {
      const midpoint = touchMidpoint(event.touches);
      const scale = clampGraphZoom(
        gesture.startViewport.scale *
          (touchDistance(event.touches) / gesture.startDistance),
      );
      const zoomed = zoomGraphAt(
        gesture.startViewport,
        scale,
        gesture.startMidpoint,
      );
      setViewport({
        ...zoomed,
        x: zoomed.x + midpoint.x - gesture.startMidpoint.x,
        y: zoomed.y + midpoint.y - gesture.startMidpoint.y,
      });
      return;
    }
    if (event.touches.length !== 1) return;

    const point = touchPoint(event.touches[0]);
    if (gesture.kind === "pan") {
      setViewport({
        ...gesture.startViewport,
        x: gesture.startViewport.x + point.x - gesture.startPoint.x,
        y: gesture.startViewport.y + point.y - gesture.startPoint.y,
      });
    } else if (gesture.kind === "node") {
      onMoveNode(
        gesture.nodeId,
        gesture.nodeX + (point.x - gesture.startPoint.x) / gesture.scale,
        gesture.nodeY + (point.y - gesture.startPoint.y) / gesture.scale,
      );
    }
  };

  const onTouchEnd = (event: React.TouchEvent) => {
    event.preventDefault();
    if (event.touches.length === 1) {
      beginTouchGesture(event.touches, null);
    } else if (event.touches.length === 0) {
      touchGesture.current = null;
      setDragging(false);
    }
  };

  const zoomAtCenter = (factor: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const current = viewportRef.current;
    setViewport(
      zoomGraphAt(current, current.scale * factor, {
        x: rect.width / 2,
        y: rect.height / 2,
      }),
    );
  };

  return (
    <div
      ref={containerRef}
      onPointerDown={onCanvasDown}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => {
        touchGesture.current = null;
        setDragging(false);
      }}
      className={`relative flex-1 overflow-hidden bg-ink bg-[linear-gradient(rgba(243,242,242,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(243,242,242,.05)_1px,transparent_1px)] bg-[length:32px_32px] ${
        dragging ? "cursor-grabbing" : "cursor-grab"
      }`}
      style={{
        touchAction: "none",
        backgroundPosition: `${viewport.x}px ${viewport.y}px`,
        backgroundSize: `${32 * viewport.scale}px ${32 * viewport.scale}px`,
      }}
    >
      <div
        className="absolute left-0 top-0"
        style={{
          transform: `translate3d(${viewport.x}px,${viewport.y}px,0) scale(${viewport.scale})`,
          transformOrigin: "0 0",
        }}
      >
        <svg
          width="1320"
          height="700"
          className="pointer-events-none absolute left-0 top-0 overflow-visible"
        >
          <defs>
            <marker
              id="varw"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,1 L9,5 L0,9 z" fill="rgba(243,242,242,.5)" />
            </marker>
          </defs>
          {edges.map((e) => {
            const a = byId.get(e.from);
            const b = byId.get(e.to);
            if (!a || !b) return null;
            return (
              <path
                key={e.id}
                d={edgePath(a, b)}
                fill="none"
                stroke="rgba(243,242,242,.42)"
                strokeWidth="1.5"
                markerEnd="url(#varw)"
              />
            );
          })}
        </svg>

        {edges.map((e) => {
          const a = byId.get(e.from);
          const b = byId.get(e.to);
          if (!a || !b || !e.condition) return null;
          const m = edgeMidpoint(a, b);
          const affirmative = e.condition === "Qualified" || e.condition === "Yes";
          return (
            <span
              key={e.id}
              className={`absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap border border-bone/[.26] bg-ink px-[7px] py-[3px] text-[10px] uppercase tracking-[.1em] ${
                affirmative ? "text-blush" : "text-bone/60"
              }`}
              style={{ left: m.x, top: m.y }}
            >
              {e.condition}
            </span>
          );
        })}

        {nodes.map((n) => {
          const chrome = NODE_CHROME[n.type];
          const selected = selectedId === n.id;
          return (
            <div
              key={n.id}
              data-workflow-node-id={n.id}
              onPointerDown={(e) => onNodeDown(e, n)}
              className="absolute flex cursor-grab select-none flex-col gap-1 px-[13px] py-2.5 transition-shadow duration-100"
              style={{
                left: n.x,
                top: n.y,
                width: NODE_W,
                minHeight: NODE_H,
                background: chrome.fill,
                color: chrome.text,
                border: chrome.border,
                boxShadow: selected ? "0 0 0 3px rgba(236,48,19,.45)" : "none",
              }}
            >
              <div
                className="text-[9.5px] uppercase tracking-[.14em]"
                style={{ color: chrome.kickerColor }}
              >
                {chrome.kicker}
              </div>
              <div className="text-sm font-extrabold leading-[1.2] tracking-[-.01em]">
                {n.label}
              </div>
              <div
                className="mt-auto text-[10.5px] tracking-[.02em]"
                style={{
                  color:
                    n.type === "terminal"
                      ? "rgba(26,24,23,.5)"
                      : "rgba(243,242,242,.42)",
                }}
              >
                {n.captures.join(" · ")}
              </div>
            </div>
          );
        })}
      </div>

      <div className="pointer-events-none absolute bottom-3.5 left-4 flex gap-3.5 text-[10.5px] uppercase tracking-[.1em] text-bone/40">
        <span>Drag nodes · drag to pan · pinch or Ctrl-scroll to zoom</span>
      </div>

      <div
        className="absolute bottom-3.5 right-4 flex items-center border border-bone/[.26] bg-panel"
        onPointerDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => zoomAtCenter(1 / 1.2)}
          aria-label="Zoom out"
          className="grid size-9 cursor-pointer place-items-center border-0 border-r border-bone/[.2] bg-transparent text-lg text-bone hover:bg-bone/[.07]"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => setViewport({ x: 0, y: 0, scale: 1 })}
          aria-label={`Reset zoom, currently ${Math.round(viewport.scale * 100)} percent`}
          className="h-9 min-w-14 cursor-pointer border-0 border-r border-bone/[.2] bg-transparent px-2 text-[11px] font-extrabold text-bone/65 hover:bg-bone/[.07]"
        >
          {Math.round(viewport.scale * 100)}%
        </button>
        <button
          type="button"
          onClick={() => zoomAtCenter(1.2)}
          aria-label="Zoom in"
          className="grid size-9 cursor-pointer place-items-center border-0 bg-transparent text-lg text-bone hover:bg-bone/[.07]"
        >
          +
        </button>
      </div>
    </div>
  );
}
