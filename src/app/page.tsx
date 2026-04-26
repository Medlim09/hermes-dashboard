"use client";

import { useState } from "react";
import { useChat }  from "@/hooks/useChat";
import { useAgent } from "@/hooks/useAgent";
import { useGuard } from "@/hooks/useGuard";
import Sidebar      from "@/components/sidebar/Sidebar";
import ChatPanel    from "@/components/chat/ChatPanel";
import AgentStatus  from "@/components/status/AgentStatus";
import LogsPanel    from "@/components/logs/LogsPanel";
import GuardBadge   from "@/components/status/GuardBadge";

export default function Page() {
  const chat  = useChat();
  const agent = useAgent();
  const guard = useGuard();

  const [navOpen,    setNavOpen]    = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  return (
    <div className="flex h-full w-full relative">
      {/* Mobile top bar */}
      <header className="md:hidden absolute top-0 inset-x-0 z-30 h-12 px-3
                         flex items-center justify-between
                         bg-zinc-950/95 backdrop-blur border-b border-zinc-800">
        <button
          onClick={() => setNavOpen(true)}
          aria-label="Open menu"
          className="p-2 -ml-2 text-zinc-300 hover:text-white"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6"  x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-hermes-500 dot-live" />
          <span className="text-sm font-semibold tracking-wide">HERMES</span>
        </div>
        <button
          onClick={() => setStatusOpen(true)}
          aria-label="Open status"
          className="p-2 -mr-2 text-zinc-300 hover:text-white"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2v4" /><path d="M12 18v4" />
            <path d="M4.93 4.93l2.83 2.83" /><path d="M16.24 16.24l2.83 2.83" />
            <path d="M2 12h4" /><path d="M18 12h4" />
            <path d="M4.93 19.07l2.83-2.83" /><path d="M16.24 7.76l2.83-2.83" />
          </svg>
        </button>
      </header>

      {/* Sidebar — drawer on mobile, static on md+ */}
      <div
        className={`md:static md:translate-x-0 md:shadow-none md:z-auto
                    fixed inset-y-0 left-0 z-50 transform transition-transform duration-200
                    ${navOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <Sidebar onClose={() => setNavOpen(false)} />
      </div>
      {navOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/60"
          onClick={() => setNavOpen(false)}
        />
      )}

      {/* Main chat */}
      <main className="flex-1 flex flex-col min-w-0 md:border-x md:border-zinc-800 pt-12 md:pt-0">
        <ChatPanel
          messages={chat.messages}
          loading={chat.loading}
          onSend={chat.send}
        />
      </main>

      {/* Status/logs — drawer on mobile, static on md+ */}
      <aside
        className={`md:static md:translate-x-0 md:w-80 md:shrink-0 md:flex md:flex-col md:bg-zinc-900 md:overflow-hidden
                    fixed inset-y-0 right-0 z-50 w-80 max-w-[85vw] flex flex-col bg-zinc-900
                    transform transition-transform duration-200
                    ${statusOpen ? "translate-x-0" : "translate-x-full md:translate-x-0"}`}
      >
        <div className="md:hidden flex justify-end px-3 py-2 border-b border-zinc-800">
          <button
            onClick={() => setStatusOpen(false)}
            aria-label="Close status"
            className="p-2 text-zinc-300 hover:text-white"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="6" y1="6"  x2="18" y2="18" />
              <line x1="6" y1="18" x2="18" y2="6" />
            </svg>
          </button>
        </div>
        <AgentStatus status={agent.status} />
        <LogsPanel   logs={agent.logs} />
        <GuardBadge  report={guard.report} />
      </aside>
      {statusOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/60"
          onClick={() => setStatusOpen(false)}
        />
      )}
    </div>
  );
}
