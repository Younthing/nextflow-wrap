"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

import { TooltipProvider } from "@/components/ui/tooltip";
import { startMocking } from "@/lib/mocking";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
    },
  });
}

/** Holds rendering until the MSW worker is ready so no request escapes it. */
function MockingGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    startMocking().finally(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        正在启动…
      </div>
    );
  }
  return children;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MockingGate>{children}</MockingGate>
      </TooltipProvider>
      {process.env.NODE_ENV === "development" && (
        <ReactQueryDevtools buttonPosition="bottom-left" />
      )}
    </QueryClientProvider>
  );
}
