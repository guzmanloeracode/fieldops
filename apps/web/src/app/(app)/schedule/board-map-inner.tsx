"use client";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { MAP_STYLE } from "@/lib/map-style";

export interface MapMarker {
  id: string;
  number: string;
  title: string;
  time: string;
  technicians: string;
  status: string;
  color: string;
  latitude: number;
  longitude: number;
}

/** Popup content built with DOM nodes, never HTML strings: job titles are user input. */
function popupContent(m: MapMarker): HTMLElement {
  const root = document.createElement("div");
  root.className = "space-y-0.5 text-xs text-slate-900";
  const link = document.createElement("a");
  link.href = `/jobs/${m.number}`;
  link.className = "block font-semibold underline";
  link.textContent = `${m.number} · ${m.title}`;
  const meta = document.createElement("p");
  meta.textContent = `${m.time} · ${m.status}`;
  const who = document.createElement("p");
  who.textContent = m.technicians;
  root.append(link, meta, who);
  return root;
}

export function BoardMapInner({ markers, label }: { markers: MapMarker[]; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || markers.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    for (const m of markers) bounds.extend([m.longitude, m.latitude]);
    const map = new maplibregl.Map({
      container: ref.current,
      style: MAP_STYLE,
      bounds,
      fitBoundsOptions: { padding: 48, maxZoom: 14 },
      attributionControl: { compact: true },
      cooperativeGestures: true,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    for (const m of markers) {
      new maplibregl.Marker({ color: m.color })
        .setLngLat([m.longitude, m.latitude])
        .setPopup(new maplibregl.Popup({ offset: 24, closeButton: true }).setDOMContent(popupContent(m)))
        .addTo(map);
    }
    return () => map.remove();
  }, [markers]);
  return (
    <div
      ref={ref}
      role="region"
      aria-label={label}
      className="h-[28rem] w-full overflow-hidden rounded-xl border"
      data-testid="board-map"
    />
  );
}
