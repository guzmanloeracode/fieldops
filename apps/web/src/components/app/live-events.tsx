"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

// Live updates (NOT-05, SCH-06): one EventSource per tab on /api/v1/stream, shared by every component that wants
// to react to changes. Events carry ids only; components refetch through the usual pages and actions.

export type LiveKind = "job" | "time_off" | "expense" | "notification" | "quote" | "invoice" | "resync";
export interface LiveMessage {
  kind: LiveKind;
  id: string | null;
}
type Listener = (message: LiveMessage) => void;

const LiveContext = createContext<{ subscribe: (listener: Listener) => () => void } | null>(null);

export function LiveEventsProvider({ children }: { children: ReactNode }) {
  const [hub] = useState(() => {
    const listeners = new Set<Listener>();
    return {
      listeners,
      subscribe(listener: Listener) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    };
  });

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource("/api/v1/stream");
    const dispatch = (message: LiveMessage) => {
      for (const listener of hub.listeners) listener(message);
    };
    let connectedBefore = false;
    // After a reconnect, changes may have been missed: ask everyone to refresh.
    source.addEventListener("ready", () => {
      if (connectedBefore) dispatch({ kind: "resync", id: null });
      connectedBefore = true;
    });
    for (const kind of ["job", "time_off", "expense", "notification"] as const) {
      source.addEventListener(kind, (e) => {
        let id: string | null = null;
        try {
          id = (JSON.parse((e as MessageEvent<string>).data) as { id?: string | null }).id ?? null;
        } catch {
          // keep id null
        }
        dispatch({ kind, id });
      });
    }
    return () => source.close();
  }, [hub]);

  return <LiveContext.Provider value={hub}>{children}</LiveContext.Provider>;
}

/** Calls `onEvent` for live messages of these kinds ("resync" after a reconnect is always included). */
export function useLiveEvents(kinds: readonly LiveKind[], onEvent: (message: LiveMessage) => void) {
  const ctx = useContext(LiveContext);
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  });
  const key = kinds.join(",");
  useEffect(() => {
    if (!ctx) return;
    const wanted = new Set<LiveKind>([...(key.split(",") as LiveKind[]), "resync"]);
    return ctx.subscribe((m) => {
      if (wanted.has(m.kind)) handler.current(m);
    });
  }, [ctx, key]);
}
