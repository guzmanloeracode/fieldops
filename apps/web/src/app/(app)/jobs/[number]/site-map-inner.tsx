"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { MAP_STYLE, maplibregl } from "@/lib/maplibre";

export function SiteMapInner({
  latitude,
  longitude,
  label,
}: {
  latitude: number;
  longitude: number;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const t = useTranslations("jobs.detail");
  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: MAP_STYLE,
      center: [longitude, latitude],
      zoom: 13.5,
      attributionControl: { compact: true },
      cooperativeGestures: true,
    });
    new maplibregl.Marker({ color: "#0369a1" }).setLngLat([longitude, latitude]).addTo(map);
    return () => map.remove();
  }, [latitude, longitude]);
  return (
    <div
      ref={ref}
      role="region"
      aria-label={t("mapOf", { place: label })}
      className="h-44 w-full overflow-hidden rounded-lg border"
    />
  );
}
