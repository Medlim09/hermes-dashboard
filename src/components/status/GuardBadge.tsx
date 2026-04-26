"use client";

import type { GuardReport, GuardIssue } from "@/hooks/useGuard";

interface Props {
  report: GuardReport | null;
}

const SEV_COLOR: Record<string, string> = {
  CRITICAL: "text-red-400",
  HIGH:     "text-orange-400",
  MEDIUM:   "text-yellow-400",
  LOW:      "text-zinc-400",
};

const STATUS_DOT: Record<string, string> = {
  HEALTHY:  "bg-emerald-500",
  WARNING:  "bg-yellow-400",
  CRITICAL: "bg-red-500",
};

export default function GuardBadge({ report }: Props) {
  if (!report) {
    return (
      <div className="px-4 py-3 border-t border-zinc-800 text-xs text-zinc-500">
        Guard loading…
      </div>
    );
  }

  const { status, issues, checked_at } = report;
  const dotColor = STATUS_DOT[status] ?? "bg-zinc-500";
  const time = checked_at ? new Date(checked_at).toLocaleTimeString() : "";

  return (
    <div className="border-t border-zinc-800 px-4 py-3 space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${dotColor}`} />
          <span className="text-xs font-semibold tracking-wide text-zinc-300">
            GUARD
          </span>
        </div>
        <span className={`text-xs font-semibold ${status === "HEALTHY" ? "text-emerald-400" : status === "CRITICAL" ? "text-red-400" : "text-yellow-400"}`}>
          {status}
        </span>
      </div>

      {/* Issues */}
      {issues.length > 0 ? (
        <ul className="space-y-1.5 max-h-40 overflow-y-auto">
          {issues.map((issue: GuardIssue, i: number) => (
            <li key={i} className="text-xs space-y-0.5">
              <div className="flex items-center gap-1.5">
                <span className={`font-medium ${SEV_COLOR[issue.severity] ?? "text-zinc-400"}`}>
                  [{issue.severity}]
                </span>
                <span className="text-zinc-300">{issue.type}</span>
              </div>
              <p className="text-zinc-500 leading-tight pl-1">{issue.description}</p>
              <p className="text-zinc-600 leading-tight pl-1 italic">{issue.suggestion}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-zinc-500">All checks passed.</p>
      )}

      {time && (
        <p className="text-[10px] text-zinc-700">checked {time}</p>
      )}
    </div>
  );
}
