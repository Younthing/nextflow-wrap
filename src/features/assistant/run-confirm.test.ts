import { act, createElement, useEffect, useRef, type ReactNode } from "react";
import { createRoot, type RootOptions } from "react-dom/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { useRunConfirm, type RunConfirmApi } from "./run-confirm";
import type { RunConfirmView } from "./run-actions";

// react-dom reads window.event while scheduling an update. Document stays
// unset so this remains a node test rather than a browser environment.
const previousWindow = globalThis.window;
globalThis.window = {
  event: undefined,
  HTMLIFrameElement: class HTMLIFrameElement {},
} as unknown as Window & typeof globalThis;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterAll(() => {
  if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window");
  else globalThis.window = previousWindow;
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

const view: RunConfirmView = {
  title: "启动运行",
  message: "将启动。",
  type: "default",
  itemList: [],
  problems: [],
  declinedMessage: "用户取消了确认，没有启动运行。",
};

function Probe({ publish }: { publish: (api: RunConfirmApi, setups: number) => void }): ReactNode {
  const api = useRunConfirm();
  const setups = useRef(0);
  useEffect(() => {
    setups.current += 1;
    publish(api, setups.current);
  });
  return null;
}

/** Enough of an element for createRoot to commit a component that renders null. */
function host(): HTMLElement {
  const children: HostNode[] = [];
  const node: HostNode = {
    nodeType: 1,
    nodeName: "DIV",
    tagName: "DIV",
    ownerDocument: null,
    firstChild: null,
    childNodes: children,
    style: {},
    addEventListener() {},
    removeEventListener() {},
    appendChild(child: HostNode) {
      child.parentNode = node;
      children.push(child);
      node.firstChild = children[0] ?? null;
      return child;
    },
    removeChild(child: HostNode) {
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
      child.parentNode = null;
      node.firstChild = children[0] ?? null;
      return child;
    },
    insertBefore(child: HostNode) {
      return node.appendChild(child);
    },
  };
  return node as unknown as HTMLElement;
}

interface HostNode {
  nodeType: number;
  nodeName: string;
  tagName: string;
  ownerDocument: null;
  firstChild: HostNode | null;
  childNodes: HostNode[];
  parentNode?: HostNode | null;
  style: Record<string, string>;
  addEventListener: () => void;
  removeEventListener: () => void;
  appendChild: (child: HostNode) => HostNode;
  removeChild: (child: HostNode) => HostNode;
  insertBefore: (child: HostNode) => HostNode;
}

async function mount(strict = false) {
  let api: RunConfirmApi | null = null;
  let setups = 0;
  const root = createRoot(host(), strict ? { unstable_strictMode: true } as RootOptions : undefined);
  await act(async () => {
    root.render(createElement(Probe, {
      publish: (next, count) => {
        api = next;
        setups = count;
      },
    }));
  });
  if (!api) throw new Error("confirmation hook did not mount");
  const current: RunConfirmApi = api;
  return {
    api: current,
    setups,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
}

/** Fails the test if a confirmation promise never settles. */
function settled(promise: Promise<true | null>) {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error("confirmation never settled")), 200);
    }),
  ]);
}

describe("useRunConfirm", () => {
  let unmount: (() => Promise<void>) | null = null;

  afterEach(async () => {
    await unmount?.();
    unmount = null;
  });

  it("confirms, ignores dismiss while busy, and declines a second ask", async () => {
    const mounted = await mount();
    unmount = mounted.unmount;
    const pending = mounted.api.ask(view);
    mounted.api.confirm();
    await expect(settled(pending)).resolves.toBe(true);
    mounted.api.dismiss();
    await expect(settled(mounted.api.ask(view))).resolves.toBeNull();
    mounted.api.close();
    const next = mounted.api.ask(view);
    const early = await Promise.race([
      next.then((value) => value),
      new Promise<"open">((resolve) => { setTimeout(() => resolve("open"), 20); }),
    ]);
    expect(early).toBe("open");
    mounted.api.dismiss();
    await expect(settled(next)).resolves.toBeNull();
  });

  it("treats unmount as cancel, including an ask that arrives afterwards", async () => {
    const mounted = await mount();
    const pending = mounted.api.ask(view);
    await mounted.unmount();
    await expect(settled(pending)).resolves.toBeNull();
    await expect(settled(mounted.api.ask(view))).resolves.toBeNull();
  });

  it("keeps asking after Strict Mode replays the unmount cleanup", async () => {
    const mounted = await mount(true);
    unmount = mounted.unmount;
    expect(mounted.setups).toBe(2);
    const pending = mounted.api.ask(view);
    const early = await Promise.race([
      pending.then((value) => value),
      new Promise<"open">((resolve) => { setTimeout(() => resolve("open"), 20); }),
    ]);
    expect(early).toBe("open");
    mounted.api.dismiss();
    await expect(settled(pending)).resolves.toBeNull();
  });
});
