"use client";

import { useEffect, useRef } from "react";
import type { Message } from "@/lib/types";
import ChatMessage from "./ChatMessage";
import ChatInput   from "./ChatInput";

interface Props {
  messages: Message[];
  loading:  boolean;
  onSend:   (text: string) => void;
}

export default function ChatPanel({ messages, loading, onSend }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, loading]);

  return (
    <section className="flex-1 flex flex-col min-h-0 bg-zinc-950">
      <header className="hidden md:block px-6 py-3 border-b border-zinc-800">
        <h2 className="text-sm font-medium text-zinc-200">Hermes Chat</h2>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.length === 0 && (
            <p className="text-center text-sm text-zinc-500 mt-8">
              Ask Hermes anything to get started.
            </p>
          )}
          {messages.map((m) => (
            <ChatMessage key={m.id} message={m} />
          ))}
          {loading && (
            <div className="text-xs text-zinc-500">Hermes is thinking…</div>
          )}
        </div>
      </div>

      <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-zinc-800 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <ChatInput onSend={onSend} disabled={loading} />
      </div>
    </section>
  );
}
