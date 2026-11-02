import type { Metadata } from "next";

import { ModuleCatalog } from "@/features/workflow/components/module-catalog";

export const metadata: Metadata = { title: "模块库" };
export const instant = false;

export default function ModuleCatalogPage() {
  return <ModuleCatalog />;
}