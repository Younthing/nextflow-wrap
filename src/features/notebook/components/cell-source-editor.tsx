"use client";

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";

import { applyCompletion, completeAt, indentAt, tabEdit, type Completion } from "@/features/notebook/complete";
import { HIGHLIGHT_CLASS, highlightSource } from "@/features/notebook/highlight";
import { interpretNotebookKey, toNotebookKeyEvent } from "@/features/notebook/keyboard";
import type { NotebookLanguage } from "@/features/notebook/types";
import { cn } from "@/lib/utils";

const FIELD = "m-0 min-h-28 w-full whitespace-pre-wrap break-words px-3 py-2 font-mono text-xs leading-5";

export function CellSourceEditor({
  cellId,
  value,
  language,
  scope,
  disabled,
  label,
  inputRef,
  onChange,
  onKeyDown,
  onFocus,
  onMenu,
}: {
  cellId: string;
  value: string;
  language: NotebookLanguage;
  scope: string;
  disabled: boolean;
  label: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (source: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onFocus: () => void;
  onMenu?: (open: boolean) => void;
}) {
  const pendingRange = useRef<{ start: number; end: number } | null>(null);
  const [session, setSession] = useState<Completion | null>(null);
  const [index, setIndex] = useState(0);
  const tokens = highlightSource(value, language);
  const items = session?.items ?? [];
  const active = items.length === 0 ? 0 : Math.min(index, items.length - 1);
  const listId = `complete-${cellId}`;
  const shown = items.length > 0;

  const setMenu = (next: Completion | null) => {
    setSession(next);
    onMenu?.(next !== null && next.items.length > 0);
  };

  const completionFrom = (node: HTMLTextAreaElement) =>
    completeAt(language, node.value, node.selectionStart ?? node.value.length, scope);

  const field = () => inputRef.current;

  useLayoutEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    node.style.height = "0px";
    node.style.height = `${node.scrollHeight}px`;
    if (pendingRange.current === null) return;
    const next = pendingRange.current;
    pendingRange.current = null;
    node.setSelectionRange(next.start, next.end);
  }, [value, inputRef]);

  const write = (next: { source: string; start: number; end?: number }) => {
    const end = next.end ?? next.start;
    if (next.source === value) {
      pendingRange.current = null;
      field()?.setSelectionRange(next.start, end);
      return;
    }
    pendingRange.current = { start: next.start, end };
    onChange(next.source);
  };

  const accept = (word: string, node: HTMLTextAreaElement, from: Completion) => {
    const caret = node.selectionStart ?? node.value.length;
    const applied = applyCompletion(node.value, caret, from.start, word);
    write({ source: applied.source, start: applied.cursor });
    setMenu(null);
  };

  return (
    <div className="relative">
      <div className="grid">
        <pre
          aria-hidden
          data-testid={`cell-highlight-${cellId}`}
          className={cn(FIELD, "pointer-events-none col-start-1 row-start-1")}
        >
          {tokens.map((token, tokenIndex) =>
            token.kind ? (
              <span key={tokenIndex} className={HIGHLIGHT_CLASS[token.kind]}>{token.text}</span>
            ) : (
              <span key={tokenIndex}>{token.text}</span>
            ),
          )}
          {value.endsWith("\n") ? "\u200b" : null}
        </pre>
        <textarea
          ref={inputRef}
          value={value}
          disabled={disabled}
          spellCheck={false}
          wrap="soft"
          aria-label={label}
          aria-autocomplete="list"
          aria-controls={shown ? listId : undefined}
          className={cn(FIELD, "cell-source col-start-1 row-start-1 resize-none overflow-hidden border-0 bg-transparent shadow-none outline-none")}
          onFocus={onFocus}
          onChange={(event) => {
            onChange(event.target.value);
            if (!session) return;
            const next = completionFrom(event.target);
            setMenu(next && next.items.length > 0 ? next : null);
          }}
          onBlur={() => {
            window.setTimeout(() => {
              if (document.activeElement === inputRef.current) return;
              setMenu(null);
            }, 0);
          }}
          onKeyDown={(event) => {
            const chord = interpretNotebookKey("edit", toNotebookKeyEvent(event), false);
            if (chord.command?.type === "run" || chord.command?.type === "command") {
              setMenu(null);
              onKeyDown(event);
              return;
            }
            if (event.nativeEvent.isComposing) {
              onKeyDown(event);
              return;
            }
            const node = event.currentTarget;
            const selectionStart = node.selectionStart ?? node.value.length;
            const selectionEnd = node.selectionEnd ?? selectionStart;
            const live = completionFrom(node);
            const menuOpen = shown && session;
            if (menuOpen && !event.shiftKey) {
              if (event.key === "Escape") {
                event.preventDefault();
                setMenu(null);
                return;
              }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const delta = event.key === "ArrowDown" ? 1 : -1;
                setIndex((current) => Math.min(items.length - 1, Math.max(0, Math.min(current, items.length - 1) + delta)));
                return;
              }
              if ((event.key === "Enter" || event.key === "Tab") && !event.ctrlKey && !event.metaKey && !event.altKey) {
                event.preventDefault();
                const word = items[active];
                if (word) accept(word, node, session);
                return;
              }
            }
            if ((event.ctrlKey || event.metaKey) && event.key === " " && !event.shiftKey && !event.altKey) {
              event.preventDefault();
              if (live && live.items.length > 0) {
                setIndex(0);
                setMenu(live);
              }
              return;
            }
            if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
              event.preventDefault();
              const decision = tabEdit(language, node.value, selectionStart, selectionEnd, event.shiftKey, scope);
              if (decision.type === "complete") {
                const only = decision.completion.items.length === 1 ? decision.completion.items[0] : undefined;
                if (only) {
                  accept(only, node, decision.completion);
                  return;
                }
                setIndex(0);
                setMenu(decision.completion);
                return;
              }
              if (menuOpen) setMenu(null);
              const edited = indentAt(node.value, selectionStart, selectionEnd, decision.type === "outdent");
              write(edited);
              return;
            }
            onKeyDown(event);
          }}
        />
      </div>
      {shown && (
        <ul
          id={listId}
          role="listbox"
          aria-label="补全"
          className="glass absolute top-full right-0 left-0 z-30 mt-1 max-h-48 overflow-auto rounded-lg p-1"
        >
          {items.map((word, itemIndex) => (
            <li
              key={word}
              id={`${listId}-${itemIndex}`}
              role="option"
              aria-selected={itemIndex === active}
              className={cn(
                "cursor-pointer rounded-md px-2 py-1 font-mono text-xs",
                itemIndex === active ? "bg-primary/15 text-foreground" : "text-muted-foreground",
              )}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setIndex(itemIndex)}
              onClick={() => {
                const node = inputRef.current;
                if (!node || !session) return;
                accept(word, node, session);
              }}
            >
              {word}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
