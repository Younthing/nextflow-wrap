"use client";

import * as React from "react";

import type { Issue } from "@/features/workflow/validate";
import { groupIssuesByNode } from "./issues";

const NONE: readonly Issue[] = [];
const NodeIssuesContext = React.createContext<ReadonlyMap<string, readonly Issue[]>>(new Map());

export function NodeIssuesProvider({ issues, children }: { issues: readonly Issue[]; children: React.ReactNode }) {
  const byNode = React.useMemo(() => groupIssuesByNode(issues), [issues]);
  return <NodeIssuesContext.Provider value={byNode}>{children}</NodeIssuesContext.Provider>;
}

export function useNodeIssues(nodeId: string): readonly Issue[] {
  return React.useContext(NodeIssuesContext).get(nodeId) ?? NONE;
}
