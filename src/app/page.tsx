import type { Metadata } from "next";

import { WelcomePage } from "@/features/workspace/components/welcome-page";

export const metadata: Metadata = { title: "欢迎" };
export const instant = false;

export default function HomePage() {
  return <WelcomePage />;
}
