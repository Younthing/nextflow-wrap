"use client";

import * as React from "react";
import { ArrowUp, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type SubmitMessage = (text: string) => void | Promise<void>;
interface QueuedMessage {
  id: string;
  text: string;
  page: string;
}

const MAX_QUEUED = 8;
export const MessageQueueContext = React.createContext<ReturnType<typeof useMessageQueue> | null>(null);

export function useMessageQueue() {
  const [items, setItems] = React.useState<QueuedMessage[]>([]);
  const [sending, setSending] = React.useState(false);
  const [paused, setPaused] = React.useState(false);
  const active = React.useRef(false);

  const send = React.useCallback((text: string, submit: SubmitMessage) => {
    if (active.current) return;
    active.current = true;
    setSending(true);
    void Promise.resolve().then(() => submit(text)).finally(() => {
      active.current = false;
      setSending(false);
    }).catch(() => {
      // CopilotKit reports request errors through the chat's onError callback.
    });
  }, []);

  const enqueue = (text: string, page: string) => {
    const item = { id: crypto.randomUUID(), text, page };
    setItems((current) => current.length >= MAX_QUEUED ? current : [...current, item]);
  };
  const remove = React.useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);
  const prioritize = (id: string) => {
    setItems((current) => {
      const selected = current.find((item) => item.id === id);
      return selected ? [selected, ...current.filter((item) => item.id !== id)] : current;
    });
  };

  return { items, sending, paused, setPaused, full: items.length >= MAX_QUEUED, send, enqueue, remove, prioritize };
}

export function QueuedMessages({ queue, page, canEdit, onEdit }: {
  queue: ReturnType<typeof useMessageQueue>;
  page: string;
  canEdit: boolean;
  onEdit: (item: QueuedMessage) => void;
}) {
  if (!queue.items.length) return null;
  const paused = queue.items[0].page !== page;
  return (
    <section aria-label="消息队列" className="pointer-events-auto mb-2 grid gap-1 rounded-lg border border-border p-2">
      <div className="flex items-center justify-between gap-2">
        <p role="status" className="px-1 text-xs font-medium">
          {paused ? "队列已暂停 · 等待原页面" : `消息队列 · ${queue.items.length} 条`}
        </p>
        {queue.paused && <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => queue.setPaused(false)}>继续队列</Button>}
      </div>
      <ol className="grid max-h-36 gap-1 overflow-auto">
        {queue.items.map((item, index) => (
          <li key={item.id} className="flex min-w-0 items-center gap-1 rounded-md bg-muted/60 px-2 py-1">
            <span className="min-w-0 flex-1 truncate text-xs" title={item.text}>{item.text}</span>
            <Button type="button" size="icon-sm" variant="ghost" className="size-7" title="优先发送" aria-label={`优先发送第 ${index + 1} 条消息`} disabled={index === 0} onClick={() => queue.prioritize(item.id)}><ArrowUp /></Button>
            <Button type="button" size="icon-sm" variant="ghost" className="size-7" title="取回编辑" aria-label={`取回第 ${index + 1} 条消息`} disabled={!canEdit} onClick={() => onEdit(item)}><Pencil /></Button>
            <Button type="button" size="icon-sm" variant="ghost" className="size-7" title="移出队列" aria-label={`移除第 ${index + 1} 条消息`} onClick={() => queue.remove(item.id)}><X /></Button>
          </li>
        ))}
      </ol>
    </section>
  );
}
