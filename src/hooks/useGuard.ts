import { useState, useEffect, useCallback } from "react";
import { getHealth } from "@/lib/api";

export interface GuardIssue {
  type:        string;
  severity:    "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  description: string;
  suggestion:  string;
}

export interface GuardReport {
  status:            "HEALTHY" | "WARNING" | "CRITICAL";
  checked_at?:       string;
  cycles_inspected?: number;
  issues:            GuardIssue[];
}

export function useGuard(intervalMs = 60_000) {
  const [report, setReport] = useState<GuardReport | null>(null);

  const refresh = useCallback(async () => {
    const data = await getHealth();
    setReport(data as GuardReport);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);

  return { report, refresh };
}
