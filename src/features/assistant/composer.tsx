"use client";

import * as React from "react";
import { CopilotChatInput, type CopilotChatInputProps } from "@copilotkit/react-core/v2";
import { RefreshCw } from "lucide-react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";

import { insertToken } from "./composer-text";

export { codeReference } from "./composer-text";

/*
 * The chat composer the host owns. Surfaces offer references (notebook variables today) that the user clicks to
 * insert into the input, like VS Code chat's context picks; the host fills CopilotKit's own input through its
 * `input` slot, so nothing about the chat UI is rebuilt.
 */

export interface ComposerReference {
  label: string;
  /** Tooltip, e.g. type and shape. */
  detail?: string;
  /** Text put into the input. */
  text: string;
}

export interface ComposerReferences {
  title: string;
  items: ComposerReference[];
  /** Shown when there is nothing to pick, e.g. why there are no variables. */
  note?: string;
  onRefresh?: () => void;
}

interface ComposerState {
  references: ComposerReferences | null;
}

const ComposerContext = React.createContext<StoreApi<ComposerState> | null>(null);
const NO_COMPOSER = createStore<ComposerState>(() => ({ references: null }));

export function ComposerProvider({ children }: { children: React.ReactNode }) {
  const [store] = React.useState(() => createStore<ComposerState>(() => ({ references: null })));
  return <ComposerContext value={store}>{children}</ComposerContext>;
}

/** Shows `references` above the chat input while the calling surface is mounted. */
export function useComposerReferences(references: ComposerReferences | null) {
  const store = React.useContext(ComposerContext);
  React.useEffect(() => {
    if (!store) return;
    store.setState({ references });
    return () => {
      if (store.getState().references === references) store.setState({ references: null });
    };
  }, [store, references]);
}

const MAX_CHIPS = 12;

function ReferenceRow({ references, onPick }: { references: ComposerReferences; onPick: (text: string) => void }) {
  const shown = references.items.slice(0, MAX_CHIPS);
  return (
    <div className="pointer-events-auto flex w-full flex-wrap items-center gap-1.5 pt-2 text-xs" aria-label={references.title}>
      <span className="text-muted-foreground">{references.title}</span>
      {shown.map((item) => (
        <button
          key={item.label}
          type="button"
          title={item.detail ? `${item.detail} · 点击插入` : "点击插入"}
          onClick={() => onPick(item.text)}
          className="rounded-full border border-border px-2 py-0.5 font-mono text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {item.label}
        </button>
      ))}
      {references.items.length > shown.length && <span className="text-muted-foreground">+{references.items.length - shown.length}</span>}
      {shown.length === 0 && references.note && <span className="text-muted-foreground">{references.note}</span>}
      {references.onRefresh && (
        <button
          type="button"
          title="刷新"
          aria-label={`刷新${references.title}`}
          onClick={references.onRefresh}
          className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <RefreshCw className="size-3" />
        </button>
      )}
    </div>
  );
}

function ChatInputWithReferences(props: CopilotChatInputProps) {
  const store = React.useContext(ComposerContext);
  const references = useStore(store ?? NO_COMPOSER, (state) => state.references);
  const wrapper = React.useRef<HTMLDivElement>(null);
  const latest = React.useRef(props);
  React.useLayoutEffect(() => {
    latest.current = props;
  });

  const insert = React.useCallback((text: string) => {
    const { value, onChange } = latest.current;
    onChange?.(insertToken(value ?? "", text));
    requestAnimationFrame(() => {
      const area = wrapper.current?.querySelector("textarea");
      area?.focus();
      area?.setSelectionRange(area.value.length, area.value.length);
    });
  }, []);

  // The references sit under the input, with the disclaimer after them: the textarea grows upwards as it fills,
  // so they stay put and a click still lands where it was aimed.
  const { showDisclaimer = true, textArea = NO_SPELLCHECK, ...input } = props;
  return (
    <div ref={wrapper} className="assistant-composer">
      <CopilotChatInput {...input} textArea={textArea} showDisclaimer={false} />
      {references && <ReferenceRow references={references} onPick={insert} />}
      {showDisclaimer && <CopilotChatInput.Disclaimer />}
    </div>
  );
}

/** Inserted references are `` `name` ``, which the browser would underline as misspelled. */
const NO_SPELLCHECK = { spellCheck: false, autoCorrect: "off", autoCapitalize: "off" };

/**
 * CopilotKit's input with the host's references row above it, for the chat's `input` slot. It keeps the input's
 * sub-components so the slot type holds; module-level so the slot stays stable between renders.
 */
export const AssistantChatInput: typeof CopilotChatInput = Object.assign(ChatInputWithReferences, CopilotChatInput);
