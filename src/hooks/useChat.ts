"use client";

import { useCallback, useState } from "react";
import { sendMessage } from "@/lib/api";
import type { Message } from "@/lib/types";

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading]   = useState(false);

  const send = useCallback(async (content: string) => {
    const text = content.trim();
    if (!text) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };
    setMessages((m) => [...m, userMsg]);
    setLoading(true);

    try {
      const { reply } = await sendMessage(text);
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: reply,
      };
      setMessages((m) => [...m, assistantMsg]);
    } finally {
      setLoading(false);
    }
  }, []);

  return { messages, loading, send };
}
