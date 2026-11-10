"use client";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";

const STYLE = process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/liberty";

export function SiteMapInner({ latitude, longitude, label }: { latitude: number; longitude: number; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: STYLE,
      center: [longitude, latitude],
      zoom: 13.5,
      attributionControl: { compact: true },
      cooperativeGestures: true,
    });
    new maplibregl.Marker({ color: "#0369a1" }).setLngLat([longitude, latitude]).addTo(map);
    return () => map.remove();
  }, [latitude, longitude]);
  return <div ref={ref} role="img" aria-label={`Map showing ${label}`} className="h-44 w-full overflow-hidden rounded-lg border" />;
}
