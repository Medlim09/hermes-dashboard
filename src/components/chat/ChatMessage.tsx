"use client";

import type { Message } from "@/lib/types";

export default function ChatMessage({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-hermes-500/15 border border-hermes-500/30 text-zinc-100"
            : "bg-zinc-900 border border-zinc-800 text-zinc-200"
        }`}
      >
        {!isUser && (
          <div className="text-[10px] uppercase tracking-wider text-hermes-400 mb-1">
            Hermes
          </div>
        )}
        <pre className="whitespace-pre-wrap font-sans">{message.content}</pre>
      </div>
    </div>
  );
}
