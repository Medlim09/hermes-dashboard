'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  onSend:   (text: string) => void
  disabled: boolean
}

export default function ChatInput({ onSend, disabled }: Props) {
  const [text, setText] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Auto-grow
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`
  }, [text])

  function submit() {
    const t = text.trim()
    if (!t || disabled) return
    onSend(t)
    setText('')
  }

  return (
    <div className="max-w-3xl mx-auto flex items-end gap-2">
      <textarea
        ref={taRef}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
        rows={1}
        placeholder="Ask Hermes anything…"
        disabled={disabled}
        className="flex-1 resize-none rounded-xl bg-zinc-900 border border-zinc-800
                   focus:border-hermes-500/50 focus:ring-1 focus:ring-hermes-500/30
                   px-4 py-2.5 text-base sm:text-sm text-zinc-100 placeholder-zinc-600
                   outline-none transition-colors disabled:opacity-50"
      />
      <button
        onClick={submit}
        disabled={disabled || !text.trim()}
        className="px-4 py-2.5 rounded-xl text-sm font-medium
                   bg-hermes-500 hover:bg-hermes-400 disabled:bg-zinc-800
                   disabled:text-zinc-600 text-zinc-950 transition-colors"
      >
        Send
      </button>
    </div>
  )
}
