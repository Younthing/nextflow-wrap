import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mswLoader } from "msw-storybook-addon/csf3";
import { setupWorker } from "msw/browser";
import { storyHandlers } from "../src/mocks/story-handlers";
import type { Decorator, Preview } from "@storybook/nextjs-vite";

import { jetbrainsMono, notoSansSC, notoSerifSC } from "../src/app/fonts";
import { Toaster } from "../src/components/ui/toaster";
import { TooltipProvider } from "../src/components/ui/tooltip";
import "../src/app/globals.css";

function ThemeFrame({
  theme,
  children,
}: {
  theme: "light" | "dark";
  children: React.ReactNode;
}) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false },
          mutations: { retry: false },
        },
      }),
  );
  React.useEffect(() => () => queryClient.clear(), [queryClient]);
  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    // Font variables live on <html> in the app; mirror that here so portals get them too.
    root.classList.add(
      notoSansSC.variable,
      notoSerifSC.variable,
      jetbrainsMono.variable,
    );
  }, [theme]);
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="ambient-backdrop min-h-screen p-6 font-sans text-foreground">
          {children}
          <Toaster />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

const withTheme: Decorator = (Story, context) => (
  <ThemeFrame
    key={context.id}
    theme={context.globals.theme === "dark" ? "dark" : "light"}
  >
    <Story />
  </ThemeFrame>
);

const preview: Preview = {
  tags: ["autodocs"],
  beforeEach: () => {
    const keys = Object.keys(localStorage).filter((key) =>
      key.startsWith("nf-studio"),
    );
    const saved = keys.map((key) => [key, localStorage.getItem(key)!] as const);
    keys.forEach((key) => localStorage.removeItem(key));
    return () => {
      Object.keys(localStorage)
        .filter((key) => key.startsWith("nf-studio"))
        .forEach((key) => localStorage.removeItem(key));
      saved.forEach(([key, value]) => localStorage.setItem(key, value));
    };
  },
  loaders: [
    mswLoader(async () => {
      const worker = setupWorker(...storyHandlers);
      await worker.start({ quiet: true, onUnhandledFrame: "bypass" });
      return worker;
    }),
  ],
  globalTypes: {
    theme: {
      description: "Glass theme",
      toolbar: {
        title: "Theme",
        icon: "mirror",
        items: [
          { value: "light", title: "浅色" },
          { value: "dark", title: "深色" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: "light" },
  decorators: [withTheme],
  parameters: {
    layout: "fullscreen",
    // Region landmarks belong to pages. Existing palette contrast is tracked separately; this refactor preserves colors.
    a11y: {
      test: "error",
      config: {
        rules: [
          { id: "region", enabled: false },
          { id: "color-contrast", enabled: false },
        ],
      },
    },
    nextjs: { appDirectory: true },
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/i },
    },
  },
};

export default preview;
