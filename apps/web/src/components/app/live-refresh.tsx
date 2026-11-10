"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useLiveEvents, type LiveKind } from "./live-events";

/**
 * Refreshes the page's server data shortly after a live change (SCH-06): several changes in a row cause one
 * refresh, and nothing happens while `paused` (a drag in progress, a save in flight) — the refresh waits.
 */
export function useLiveRefresh(
  kinds: readonly LiveKind[],
  opts: { paused?: boolean; delayMs?: number } = {},
) {
  const router = useRouter();
  const paused = useRef(opts.paused ?? false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delay = opts.delayMs ?? 600;
  useEffect(() => {
    paused.current = opts.paused ?? false;
  });
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useLiveEvents(kinds, () => {
    if (timer.current) return;
    const fire = () => {
      if (paused.current) {
        timer.current = setTimeout(fire, 500);
        return;
      }
      timer.current = null;
      router.refresh();
    };
    timer.current = setTimeout(fire, delay);
  });
}

/** Drop-in for server-rendered pages: refreshes them on live changes of these kinds. */
export function LiveRefresh({ kinds }: { kinds: readonly LiveKind[] }) {
  useLiveRefresh(kinds);
  return null;
}
