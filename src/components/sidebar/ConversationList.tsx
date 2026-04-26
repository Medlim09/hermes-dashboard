"use client";

interface Item {
  id:    string;
  title: string;
}

interface Props {
  items?:    Item[];
  activeId?: string;
  onSelect?: (id: string) => void;
}

export default function ConversationList({
  items = [], activeId, onSelect,
}: Props) {
  if (items.length === 0) {
    return (
      <p className="px-4 py-6 text-xs text-zinc-600">
        No conversations yet.
      </p>
    );
  }

  return (
    <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
      {items.map((c) => {
        const active = c.id === activeId;
        return (
          <div
            key={c.id}
            onClick={() => onSelect?.(c.id)}
            className={`px-2.5 py-2 rounded-lg cursor-pointer text-sm truncate transition-colors
              ${active
                ? "bg-zinc-800/80 ring-1 ring-zinc-700 text-zinc-100"
                : "hover:bg-zinc-800/40 text-zinc-300"}`}
          >
            {c.title}
          </div>
        );
      })}
    </nav>
  );
}
