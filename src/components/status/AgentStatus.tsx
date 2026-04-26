"use client";

import type { AgentStatus as Status } from "@/lib/types";

export default function AgentStatus({ status }: { status: Status | null }) {
  const running = status?.state === "running";

  return (
    <section className="border-b border-zinc-800 px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wider uppercase text-zinc-300">
          Agent
        </h3>
        <span
          className={`text-[10px] uppercase tracking-wider ${
            running ? "text-emerald-400" : "text-zinc-500"
          }`}
        >
          {status?.state ?? "—"}
        </span>
      </div>

      <div className="rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">
          Last action
        </div>
        <div className="text-sm text-zinc-200 mt-0.5">
          {status?.lastAction ?? "—"}
        </div>
      </div>
    </section>
  );
}
