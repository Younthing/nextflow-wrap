import type { Metadata } from "next";

import { OutputsPage } from "@/features/outputs/components/outputs-page";

export const metadata: Metadata = { title: "产物" };
export const instant = false;

export default function OutputsRoute() {
  return <OutputsPage />;
}
