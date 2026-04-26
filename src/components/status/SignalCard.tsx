"use client";

import type { Signal } from "@/lib/types";

const TONE: Record<Signal["decision"], string> = {
  BUY:  "text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
  SELL: "text-rose-400    border-rose-500/40    bg-rose-500/10",
  WAIT: "text-zinc-400    border-zinc-700       bg-zinc-800/40",
};

export default function SignalCard({ signal }: { signal: Signal }) {
  const conf = Math.round(signal.confidence * 100);
  return (
    <div className={`rounded-xl border p-3 ${TONE[signal.decision]}`}>
      <div className="flex items-baseline justify-between">
        <span className="text-base font-semibold tracking-wide">{signal.asset}</span>
        <span className="text-xs uppercase tracking-wider opacity-80">
          {signal.decision}
        </span>
      </div>
      <div className="mt-2 h-1 rounded-full bg-zinc-900 overflow-hidden">
        <div className="h-full bg-current opacity-70" style={{ width: `${conf}%` }} />
      </div>
      <div className="mt-1 text-[11px] opacity-80">{conf}% confidence</div>
    </div>
  );
}
