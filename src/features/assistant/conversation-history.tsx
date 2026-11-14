"use client";

import * as React from "react";
import { useAgent, UseAgentUpdate, useCopilotKit } from "@copilotkit/react-core/v2";
import { toast } from "@/lib/toast";
import { conversationTitle, readConversations, restorableMessages, writeConversations } from "./history";

const RUN_UPDATES = [UseAgentUpdate.OnRunStatusChanged];

/** Project scope and the active agent are fixed for this component's lifetime. */
export function useConversationHistory(scope: string) {
  const { agent, isReady } = useAgent({ updates: RUN_UPDATES });
  const { copilotkit } = useCopilotKit();
  const [active, setActive] = React.useState(() => ({
    id: crypto.randomUUID(),
    conversations: readConversations(scope),
  }));
  const session = React.useRef(active);
  const ignoredBaseline = React.useRef(agent.messages);
  const warned = React.useRef(false);
  const menu = React.useMemo(() => ({
    active: active.id,
    conversations: active.conversations,
    busy: !isReady || agent.isRunning,
  }), [active, isReady, agent.isRunning]);

  const save = React.useCallback((publish = true) => {
    if (agent.messages === ignoredBaseline.current) return;
    const messages = restorableMessages(agent.messages);
    if (!messages.some((message) => message.role === "user")) return;
    const { id } = session.current;
    const existing = session.current.conversations.find((item) => item.id === id);
    if (existing && JSON.stringify(existing.messages) === JSON.stringify(messages)) return;
    const next = {
      id,
      conversations: [
        {
          id, messages, updatedAt: Date.now(),
          title: existing?.customTitle ? existing.title : conversationTitle(messages),
          customTitle: existing?.customTitle,
        },
        ...readConversations(scope).filter((item) => item.id !== id),
      ],
    };
    const stored = writeConversations(scope, next.conversations);
    if (stored) next.conversations = stored;
    session.current = next;
    if (!stored && !warned.current && publish) {
      warned.current = true;
      toast.error("这段对话无法保存到本机");
    }
    if (publish) setActive(next);
  }, [agent, scope]);

  React.useLayoutEffect(() => {
    agent.setMessages([]);
    agent.setState({});
    ignoredBaseline.current = agent.messages;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const subscription = agent.subscribe({
      onMessagesChanged: () => {
        clearTimeout(timer);
        timer = setTimeout(() => save(), 350);
      },
    });
    const flush = () => save(false);
    window.addEventListener("pagehide", flush);
    return () => {
      subscription.unsubscribe();
      window.removeEventListener("pagehide", flush);
      clearTimeout(timer);
      flush();
      if (agent.isRunning) void copilotkit.stopAgent({ agent });
    };
  }, [agent, copilotkit, save]);

  const open = (id: string, discard?: string) => {
    if (agent.isRunning) return;
    if (!discard) save();
    const conversations = session.current.conversations.filter((item) => item.id !== discard);
    if (discard && !writeConversations(scope, conversations)) {
      toast.error("无法删除本机对话");
      return;
    }
    const messages = restorableMessages(conversations.find((item) => item.id === id)?.messages ?? []);
    const next = { id, conversations };
    session.current = next;
    agent.setState({});
    agent.setMessages(messages);
    ignoredBaseline.current = agent.messages;
    setActive(next);
  };

  const newConversation = () => open(crypto.randomUUID());

  return {
    ...menu,
    onNew: newConversation,
    onOpen: open,
    onRename: () => {
      const current = session.current.conversations.find((item) => item.id === active.id);
      if (!current) return;
      const title = window.prompt("对话名称", current.title)?.trim().slice(0, 72);
      if (!title) return;
      const renamed = { ...current, title, customTitle: true, updatedAt: Date.now() };
      const conversations = writeConversations(scope, [renamed, ...session.current.conversations.filter((item) => item.id !== current.id)]);
      if (!conversations) {
        toast.error("无法保存对话名称");
        return;
      }
      const next = { id: active.id, conversations };
      session.current = next;
      setActive(next);
    },
    onDelete: () => {
      if (window.confirm("删除当前对话的本机记录？")) open(crypto.randomUUID(), active.id);
    },
  };
}
