"use client";

import type { Log } from "@/lib/types";
import LogItem from "./LogItem";

export default function LogsPanel({ logs }: { logs: Log[] }) {
  return (
    <section className="flex-1 flex flex-col min-h-0">
      <header className="px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wider uppercase text-zinc-300">
          Logs
        </h3>
        <span className="text-[10px] text-zinc-600">{logs.length}</span>
      </header>
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {logs.length === 0 ? (
          <p className="px-3 py-6 text-xs text-zinc-600 text-center">
            No logs yet.
          </p>
        ) : (
          logs.map((l) => <LogItem key={l.id} log={l} />)
        )}
      </div>
    </section>
  );
}
