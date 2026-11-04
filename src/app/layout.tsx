import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { Providers } from "@/components/providers";
import { getProductTheme } from "@/lib/product-theme";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { jetbrainsMono, notoSansSC, notoSerifSC } from "./fonts";
import "./globals.css";

const productTheme = getProductTheme();

export const metadata: Metadata = {
  title: {
    default: productTheme.displayName,
    template: `%s · ${productTheme.displayName}`,
  },
  description: productTheme.description,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={`${notoSansSC.variable} ${notoSerifSC.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="h-full overflow-hidden">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
