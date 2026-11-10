"use client";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

// MapLibre is large; load it only on pages that show a map.
const MapInner = dynamic(() => import("./site-map-inner").then((m) => m.SiteMapInner), {
  ssr: false,
  loading: () => <Skeleton className="h-44 w-full rounded-lg" />,
});

export function SiteMap(props: { latitude: number; longitude: number; label: string }) {
  return <MapInner {...props} />;
}
