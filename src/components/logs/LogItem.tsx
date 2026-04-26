"use client";

import type { Log } from "@/lib/types";

export default function LogItem({ log }: { log: Log }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-zinc-800/40 text-xs">
      <span className="w-1.5 h-1.5 rounded-full bg-hermes-500 shrink-0" />
      <span className="text-zinc-200 truncate">{log.message}</span>
    </div>
  );
}
