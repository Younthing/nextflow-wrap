import { act, type ReactNode } from "react";
import { createRoot, type RootOptions } from "react-dom/client";
import { afterAll, describe, expect, it } from "vitest";

import { AssistantModuleHost, useAssistantModule } from "./activation";

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

function Probe({ id }: { id: string }): ReactNode {
  useAssistantModule(id);
  return null;
}

function Tree({ ids }: { ids: readonly string[] }) {
  return ids.map((id) => <Probe key={id} id={id} />);
}

async function mount(ids: readonly string[], strict = false) {
  const seen: string[][] = [];
  const root = createRoot(host(), strict ? { unstable_strictMode: true } as RootOptions : undefined);
  const draw = (next: readonly string[]) => {
    root.render(
      <AssistantModuleHost
        onChange={(idsNow) => {
          seen.push([...idsNow]);
        }}
      >
        <Tree ids={next} />
      </AssistantModuleHost>,
    );
  };
  await act(async () => {
    draw(ids);
  });
  return {
    latest: () => seen.at(-1) ?? [],
    render: async (next: readonly string[]) => {
      await act(async () => {
        draw(next);
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
}

describe("assistant module activation", () => {
  it("adds a module while it is mounted and drops it on unmount", async () => {
    const view = await mount(["canvas-edit"]);
    expect(view.latest()).toEqual(["canvas-edit"]);
    await view.render(["canvas-edit", "notebook"]);
    expect(view.latest()).toEqual(["canvas-edit", "notebook"]);
    await view.render(["notebook", "notebook"]);
    expect(view.latest()).toEqual(["notebook"]);
    await view.render([]);
    expect(view.latest()).toEqual([]);
    await view.unmount();
  });

  it("keeps one id when strict mode replays the mount", async () => {
    const view = await mount(["publish"], true);
    expect(view.latest()).toEqual(["publish"]);
    await view.unmount();
    expect(view.latest()).toEqual([]);
  });
});
