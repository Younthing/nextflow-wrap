import * as React from "react";
import type { Decorator, Preview } from "@storybook/nextjs-vite";

import { jetbrainsMono, notoSansSC, notoSerifSC } from "../src/app/fonts";
import { TooltipProvider } from "../src/components/ui/tooltip";
import "../src/app/globals.css";

function ThemeFrame({
  theme,
  children,
}: {
  theme: "light" | "dark";
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    // Font variables live on <html> in the app; mirror that here so portals get them too.
    root.classList.add(notoSansSC.variable, notoSerifSC.variable, jetbrainsMono.variable);
  }, [theme]);
  return (
    <TooltipProvider>
      <div className="ambient-backdrop min-h-screen p-6 font-sans text-foreground">
        {children}
      </div>
    </TooltipProvider>
  );
}

const withTheme: Decorator = (Story, context) => (
  <ThemeFrame theme={context.globals.theme === "dark" ? "dark" : "light"}>
    <Story />
  </ThemeFrame>
);

const preview: Preview = {
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
    nextjs: { appDirectory: true },
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/i },
    },
  },
};

export default preview;
