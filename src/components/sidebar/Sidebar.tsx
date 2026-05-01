"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ConversationList from "./ConversationList";

interface Props {
  onClose?: () => void;
}

export default function Sidebar({ onClose }: Props) {
  const pathname = usePathname();

  return (
    <aside className="h-full w-64 max-w-[85vw] shrink-0 flex flex-col bg-zinc-950 border-r border-zinc-800">
      <div className="px-4 py-4 border-b border-zinc-800 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-hermes-500 dot-live" />
            <h1 className="text-sm font-semibold tracking-wide">HERMES</h1>
          </div>
          <p className="mt-1 text-xs text-zinc-500">Personal Economy AI</p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="md:hidden p-1 -mr-1 text-zinc-400 hover:text-white"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="6" y1="6"  x2="18" y2="18" />
              <line x1="6" y1="18" x2="18" y2="6" />
            </svg>
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-0.5 px-2 py-2 border-b border-zinc-800">
        {[
          { href: "/",          label: "Chat",          icon: "💬" },
          { href: "/dashboard", label: "Intelligence",  icon: "📡" },
        ].map(({ href, label, icon }) => (
          <Link
            key={href}
            href={href}
            onClick={onClose}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors
              ${pathname === href
                ? "bg-zinc-800 text-white"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"}`}
          >
            <span>{icon}</span>
            <span>{label}</span>
          </Link>
        ))}
      </nav>

      <ConversationList />

      <div className="px-4 py-3 border-t border-zinc-800 text-xs text-zinc-500">
        Local mock mode
      </div>
    </aside>
  );
}
