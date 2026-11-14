"use client";

import * as React from "react";
import { useAgent, UseAgentUpdate, useCopilotKit } from "@copilotkit/react-core/v2";
import { toast } from "@/lib/toast";
import { conversationTitle, readConversations, restorableMessages, writeConversations } from "./history";
import { requestConversationTitle } from "./queries";

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
  const titleRequest = React.useRef<{ id: string; controller: AbortController } | null>(null);
  const titled = React.useRef(new Set<string>());
  const titleTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
          title: existing?.customTitle || existing?.generatedTitle ? existing.title : conversationTitle(messages),
          customTitle: existing?.customTitle,
          generatedTitle: existing?.generatedTitle,
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

  const summarize = React.useCallback(() => {
    if (agent.isRunning || titleRequest.current) return;
    const { id, conversations } = session.current;
    const current = conversations.find((item) => item.id === id);
    if (!current || current.customTitle || current.generatedTitle || titled.current.has(id)) return;
    const question = current.messages.find((message) => message.role === "user")?.content;
    const answer = current.messages.find((message) => message.role === "assistant" && message.content?.trim())?.content;
    if (typeof question !== "string" || typeof answer !== "string") return;
    titled.current.add(id);
    const controller = new AbortController();
    titleRequest.current = { id, controller };
    void requestConversationTitle(question, answer, controller.signal).then((title) => {
      if (!title || controller.signal.aborted || session.current.id !== id) return;
      const latest = session.current.conversations.find((item) => item.id === id);
      if (!latest || latest.customTitle) return;
      const renamed = { ...latest, title, generatedTitle: true };
      const next = {
        id,
        conversations: session.current.conversations.map((item) => item.id === id ? renamed : item),
      };
      const stored = writeConversations(scope, next.conversations);
      if (stored) next.conversations = stored;
      session.current = next;
      setActive(next);
    }).catch(() => {
      // Keep the first-message title when the backend is busy or unavailable.
    }).finally(() => {
      if (titleRequest.current?.controller === controller) titleRequest.current = null;
    });
  }, [agent, scope]);

  React.useLayoutEffect(() => {
    agent.setMessages([]);
    agent.setState({});
    ignoredBaseline.current = agent.messages;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const subscription = agent.subscribe({
      onMessagesChanged: () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          save();
          clearTimeout(titleTimer.current);
          titleTimer.current = setTimeout(summarize, 1_200);
        }, 350);
      },
      onRunFinalized: () => {
        clearTimeout(titleTimer.current);
        titleTimer.current = setTimeout(summarize, 1_200);
      },
    });
    const flush = () => save(false);
    window.addEventListener("pagehide", flush);
    return () => {
      subscription.unsubscribe();
      window.removeEventListener("pagehide", flush);
      clearTimeout(timer);
      clearTimeout(titleTimer.current);
      titleRequest.current?.controller.abort();
      titleRequest.current = null;
      flush();
      if (agent.isRunning) void copilotkit.stopAgent({ agent });
    };
  }, [agent, copilotkit, save, summarize]);

  const open = (id: string, discard?: string) => {
    if (agent.isRunning) return;
    if (id === session.current.id && !discard) return;
    clearTimeout(titleTimer.current);
    titleRequest.current?.controller.abort();
    titleRequest.current = null;
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
    title: active.conversations.find((item) => item.id === active.id)?.title ?? "新对话",
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
