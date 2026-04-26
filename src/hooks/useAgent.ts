"use client";

import { useCallback, useEffect, useState } from "react";
import { getStatus, getLogs } from "@/lib/api";
import type { AgentStatus, Log } from "@/lib/types";

export function useAgent() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [logs,   setLogs]   = useState<Log[]>([]);

  const refresh = useCallback(async () => {
    const [s, l] = await Promise.all([getStatus(), getLogs()]);
    setStatus(s as AgentStatus);
    setLogs(l);
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 10_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  return { status, logs, refresh };
}
