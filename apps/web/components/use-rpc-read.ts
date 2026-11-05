"use client";
import { useEffect, useState } from "react";
import { rpc } from "@/lib/rpc";

export type Read<T> = { data: T | null; loading: boolean; error: string | null };

// Reads one app.* function and reloads when `key` changes (the arguments, or a reload signal from the
// page). An answer that arrives after the key changed is dropped, so a quick month switch never shows
// the wrong month. The error is the database's own message (lib/rpc.ts).
export function useRpcRead<T>(fn: string, args: Record<string, unknown>, key: string): Read<T> {
  const [state, setState] = useState<Read<T>>({ data: null, loading: true, error: null });
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for fn and args
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    const go = async () => {
      try {
        const data = await rpc<T>(fn, args);
        if (live) setState({ data, loading: false, error: null });
      } catch (e) {
        if (live) setState({ data: null, loading: false, error: (e as Error).message });
      }
    };
    void go();
    return () => {
      live = false;
    };
  }, [key]);
  return state;
}
