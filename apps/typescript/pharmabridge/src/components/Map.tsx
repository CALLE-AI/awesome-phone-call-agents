"use client";
import dynamic from "next/dynamic";

export type { MapMarker } from "./MapView";

/** Leaflet touches `window` at import time, so the map only ever renders in the browser. */
export const LiveMap = dynamic(() => import("./MapView").then((m) => m.MapView), {
  ssr: false,
  loading: () => <div className="skeleton h-full w-full" />,
});
