import {
  type FlowNode,
  type EditorStore,
  type EditorState,
} from "@/features/editor/store";
import { REFERENCE_FORMATS, REFERENCE_ID } from "@/features/workflow/builtins";
import { resolveNodeDef, searchModules } from "@/features/workflow/catalog";
import {
  inHandle,
  outHandle,
  portFromHandle,
  portSignature,
  socketInputs,
  widgetInputs,
} from "@/features/workflow/ports";
import type {
  ModuleDef,
  NodeConfig,
  PortDef,
  WidgetValue,
  WorkflowNodeData,
} from "@/features/workflow/types";
import { validateWorkflow } from "@/features/workflow/validate";

/*
 * What the AI assistant can see and do in the editor. Everything goes through
 * the editor store, so each change is one undo step like a manual edit.
 * Failures throw with a message the model can read and correct itself from.
 */

const NODE_WIDTH = 256;
const COLUMN_GAP = 96;
const ROW_GAP = 200;

const firstSentence = (text: string) =>
  text.split(/(?<=[.。])\s|\n/)[0]?.trim() ?? "";

function describePort(port: PortDef) {
  return {
    name: port.name,
    carries: portSignature(port),
    ...(port.collect && { collect: true }),
    ...(port.description && { description: firstSentence(port.description) }),
  };
}

/** A module as the model sees it: what it does and which sockets it has. */
export function describeModule(def: ModuleDef) {
  return {
    moduleId: def.id,
    name: def.name,
    process: def.process,
    category: def.category,
    description: firstSentence(def.description),
    inputs: socketInputs(def).map(describePort),
    outputs: def.outputs.map(describePort),
    widgets: widgetInputs(def).map((p) => ({ name: p.name, type: p.widget })),
  };
}

export function createEditorActions(store: EditorStore) {
  function searchCatalog(query: string, limit = 8) {
    const modules = [...store.getState().index.values()];
    return searchModules(modules, query).slice(0, limit).map(describeModule);
  }

  /** Ids close to a mistyped one: the name part of `script/<name>/v1`, shortened until something matches. */
  function nearModuleIds(moduleId: string): string[] {
    const name = moduleId.split("/").filter((part) => !/^(script|builtin|v\d+)$/.test(part)).join(" ") || moduleId;
    for (let length = name.length; length >= 3; length--) {
      const hits = searchCatalog(name.slice(0, length), 5);
      if (hits.length) return hits.map((m) => m.moduleId);
    }
    return [];
  }

  /** Finds a node by id or by its alias, ignoring case. */
  function findNode(ref: string): FlowNode {
    const { nodes } = store.getState();
    const node =
      nodes.find((n) => n.id === ref) ??
      nodes.find(
        (n) => n.data.alias.toLowerCase() === ref.trim().toLowerCase(),
      );
    if (!node) {
      const aliases =
        nodes.map((n) => n.data.alias).join(", ") || "（画布是空的）";
      throw new Error(`找不到节点 "${ref}"。现有节点：${aliases}`);
    }
    return node;
  }

  function defOf(node: FlowNode) {
    const def = resolveNodeDef(store.getState().index, node.data);
    if (!def)
      throw new Error(
        `节点 ${node.data.alias} 的模块 ${node.data.moduleId} 不在模块库里`,
      );
    return def;
  }

  /** The current workflow in a compact form, refreshed for every chat turn. */
  function workflowSummary(
    state: Pick<
      EditorState,
      "name" | "nodes" | "edges" | "params" | "index"
    > = store.getState(),
  ) {
    const { name, nodes, edges, params, index } = state;
    const aliasOf = new Map(nodes.map((n) => [n.id, n.data.alias]));
    const issues = validateWorkflow(
      nodes.map((n) => ({ id: n.id, position: n.position, data: n.data })),
      edges.map((e) => ({
        ...e,
        sourceHandle: e.sourceHandle ?? "",
        targetHandle: e.targetHandle ?? "",
      })),
      params,
      index,
    );
    return {
      name,
      params,
      nodes: nodes.map((n) => {
        const def = resolveNodeDef(index, n.data);
        return {
          id: n.id,
          alias: n.data.alias,
          moduleId: n.data.moduleId,
          ...(n.selected && { selected: true }),
          ...(n.data.disabled && { disabled: true }),
          inputs: def
            ? socketInputs(def).map((p) => `${p.name} (${portSignature(p)})`)
            : [],
          outputs: def
            ? def.outputs.map((p) => `${p.name} (${portSignature(p)})`)
            : [],
          ...(Object.keys(n.data.widgets).length > 0 && {
            widgets: n.data.widgets,
          }),
          ...(n.data.settings && { settings: n.data.settings }),
          config: n.data.config,
        };
      }),
      edges: edges.map(
        (e) =>
          `${aliasOf.get(e.source)}.${portFromHandle(e.sourceHandle)} -> ${aliasOf.get(e.target)}.${portFromHandle(e.targetHandle)}`,
      ),
      issues: issues.map((i) => ({
        level: i.level,
        ...(i.nodeId && { node: aliasOf.get(i.nodeId) }),
        message: i.message,
      })),
    };
  }

  /** Places a new node to the right of `after`, or right of everything. */
  function placeAfter(after: FlowNode | undefined) {
    const { nodes, edges } = store.getState();
    if (after) {
      const siblings = edges.filter((e) => e.source === after.id).length;
      return {
        x: after.position.x + NODE_WIDTH + COLUMN_GAP,
        y: after.position.y + siblings * ROW_GAP,
      };
    }
    if (nodes.length === 0) return { x: 0, y: 0 };
    const maxX = Math.max(...nodes.map((n) => n.position.x));
    const minY = Math.min(...nodes.map((n) => n.position.y));
    return { x: maxX + NODE_WIDTH + COLUMN_GAP, y: minY };
  }

  function addModule(args: {
    moduleId: string;
    after?: string;
    alias?: string;
  }) {
    const state = store.getState();
    const def = state.index.get(args.moduleId);
    if (!def) {
      const guesses = nearModuleIds(args.moduleId);
      throw new Error(
        `模块 ${args.moduleId} 不存在。${guesses.length ? `相近的有：${guesses.join(", ")}` : "先用 search_modules 查一下。"}`,
      );
    }
    const after = args.after ? findNode(args.after) : undefined;
    // Check everything before touching the canvas, so a failed call changes nothing.
    const alias = args.alias ? checkAlias(args.alias) : undefined;
    const node = state.addNode(def, placeAfter(after));
    if (alias) state.updateNodeData(node.id, { alias });
    const added = findNode(node.id);
    return { id: added.id, alias: added.data.alias, ...describeModule(def) };
  }

  /** Normalizes an alias and checks it is valid and not used by another node. */
  function checkAlias(alias: string, nodeId?: string) {
    const next = alias.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*$/.test(next))
      throw new Error(
        `别名 ${alias} 不合法，只能用大写字母、数字和下划线，并以字母开头`,
      );
    if (
      store
        .getState()
        .nodes.some((n) => n.id !== nodeId && n.data.alias === next)
    ) {
      throw new Error(`别名 ${next} 已经被别的节点用了`);
    }
    return next;
  }

  /** Checks a widget value against the type the module declares for it. */
  function checkWidget(
    alias: string,
    name: string,
    type: string,
    value: WidgetValue,
  ): WidgetValue {
    const expected =
      type === "boolean"
        ? "boolean"
        : type === "integer" || type === "float" || type === "number"
          ? "number"
          : "string";
    if (typeof value !== expected) {
      throw new Error(
        `${alias} 的参数 ${name} 是 ${type} 类型，收到的是 ${JSON.stringify(value)}，请传 ${expected === "boolean" ? "true 或 false" : expected === "number" ? "数字" : "字符串"}`,
      );
    }
    if (type === "integer" && !Number.isInteger(value))
      throw new Error(`${alias} 的参数 ${name} 需要整数`);
    return value;
  }

  function pickPort(
    ports: PortDef[],
    name: string | undefined,
    side: string,
    alias: string,
  ) {
    const list = ports.map((p) => p.name).join(", ") || "无";
    if (!name) {
      if (ports.length === 1) return ports[0];
      throw new Error(`${alias} 有多个${side}端口（${list}），请指定一个`);
    }
    const port = ports.find((p) => p.name === name);
    if (!port)
      throw new Error(
        `${alias} 没有名为 ${name} 的${side}端口，可用的有：${list}`,
      );
    return port;
  }

  function connectNodes(args: {
    source: string;
    sourcePort?: string;
    target: string;
    targetPort?: string;
  }) {
    const src = findNode(args.source);
    const dst = findNode(args.target);
    const out = pickPort(
      defOf(src).outputs,
      args.sourcePort,
      "输出",
      src.data.alias,
    );
    const inp = pickPort(
      socketInputs(defOf(dst)),
      args.targetPort,
      "输入",
      dst.data.alias,
    );
    const result = store.getState().connect({
      source: src.id,
      sourceHandle: outHandle(out.name),
      target: dst.id,
      targetHandle: inHandle(inp.name),
    });
    if (!result.ok) {
      throw new Error(
        `不能把 ${src.data.alias}.${out.name}（${portSignature(out)}）连到 ${dst.data.alias}.${inp.name}（${portSignature(inp)}）：${result.reason}`,
      );
    }
    return {
      connected: `${src.data.alias}.${out.name} -> ${dst.data.alias}.${inp.name}`,
      ...(result.adapter &&
        result.adapter !== "direct" && { adapter: result.adapter }),
      ...(result.warning && { warning: result.warning }),
    };
  }

  function disconnect(args: { source: string; target: string }) {
    const src = findNode(args.source);
    const dst = findNode(args.target);
    const state = store.getState();
    const drop = state.edges.filter(
      (e) => e.source === src.id && e.target === dst.id,
    );
    if (drop.length === 0)
      throw new Error(`${src.data.alias} 和 ${dst.data.alias} 之间没有连线`);
    state.onEdgesChange(drop.map((e) => ({ type: "remove", id: e.id })));
    return { removed: drop.length };
  }

  function removeNode(ref: string) {
    const node = findNode(ref);
    store.getState().removeNodes([node.id]);
    return { removed: node.data.alias };
  }

  function configureNode(args: {
    node: string;
    alias?: string;
    widgets?: Record<string, WidgetValue>;
    config?: NodeConfig;
    disabled?: boolean;
    referenceParam?: string;
    referenceFormat?: string;
  }) {
    const node = findNode(args.node);
    const def = defOf(node);
    const { alias: current } = node.data;

    // Validate the whole request first, then apply it as one change.
    const patch: Partial<WorkflowNodeData> = {};
    if (args.widgets) {
      const types = new Map(widgetInputs(def).map((p) => [p.name, p.widget!]));
      const widgets = { ...node.data.widgets };
      for (const [name, value] of Object.entries(args.widgets)) {
        const type = types.get(name);
        if (!type)
          throw new Error(
            `${current} 没有参数 ${name}，可设置的有：${[...types.keys()].join(", ") || "无"}`,
          );
        widgets[name] = checkWidget(current, name, type, value);
      }
      patch.widgets = widgets;
    }
    if (args.config) {
      if (def.builtin)
        throw new Error("输入节点没有 ext.args / publish 这些设置");
      patch.config = { ...node.data.config, ...args.config };
    }
    if (args.disabled !== undefined) patch.disabled = args.disabled;
    if (
      args.referenceParam !== undefined ||
      args.referenceFormat !== undefined
    ) {
      if (def.id !== REFERENCE_ID)
        throw new Error("只有「参考文件」节点有参数名和文件格式");
      const format = args.referenceFormat;
      if (
        format &&
        !(REFERENCE_FORMATS as readonly string[]).includes(format)
      ) {
        throw new Error(`文件格式只能是 ${REFERENCE_FORMATS.join(", ")}`);
      }
      const param = args.referenceParam?.trim();
      if (param !== undefined && !/^[a-z][a-z0-9_]*$/.test(param)) {
        throw new Error(`参数名 ${param} 不合法，只能用小写字母、数字和下划线`);
      }
      patch.settings = {
        ...node.data.settings,
        ...(param !== undefined && { param }),
        ...(format && { format }),
      };
    }
    if (args.alias) patch.alias = checkAlias(args.alias, node.id);

    store
      .getState()
      .updateNodeData(node.id, patch, `assistant:${node.id}:${Date.now()}`);
    const updated = findNode(node.id);
    return {
      id: updated.id,
      alias: updated.data.alias,
      widgets: updated.data.widgets,
      config: updated.data.config,
      settings: updated.data.settings,
    };
  }

  function setParam(key: string, value: WidgetValue | null) {
    if (!/^[a-z][a-z0-9_]*$/.test(key))
      throw new Error(`参数名 ${key} 不合法，只能用小写字母、数字和下划线`);
    store.getState().setParam(key, value ?? undefined);
    return { params: store.getState().params };
  }

  return {
    searchCatalog,
    findNode,
    workflowSummary,
    addModule,
    connectNodes,
    disconnect,
    removeNode,
    configureNode,
    setParam,
  };
}
