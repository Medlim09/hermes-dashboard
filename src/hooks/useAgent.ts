"use client";

import { useCallback, useEffect, useState } from "react";
import { getScannerStatus } from "@/lib/api";
import type { AgentStatus, Log } from "@/lib/types";

export function useAgent() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [logs,   setLogs]   = useState<Log[]>([]);

  const refresh = useCallback(async () => {
    try {
      const s = await getScannerStatus();
      setStatus({
        state:      s.running ? "running" : "stopped",
        lastAction: s.last_run
          ? `Last scan ${Math.round((Date.now() - new Date(s.last_run).getTime()) / 60000)}m ago`
          : "Waiting for first scan",
      } as AgentStatus);
      setLogs([]);
    } catch {
      // backend unreachable — silently keep last state
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 15_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  return { status, logs, refresh };
}
