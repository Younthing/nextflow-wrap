import type { Metadata } from "next";

import { NotebookList } from "@/features/notebook/components/notebook-list";

export const metadata: Metadata = { title: "笔记本" };
export const instant = false;

export default function NotebooksPage() {
  return <NotebookList />;
}
