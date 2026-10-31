import * as React from "react";
import { cva } from "class-variance-authority";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";

import { Input } from "./input";

const searchFieldVariants = cva("pl-8", {
  variants: {
    size: {
      default: "h-9",
      compact: "h-8 text-xs",
    },
  },
  defaultVariants: {
    size: "default",
  },
});

type SearchFieldProps = Omit<React.ComponentProps<"input">, "size"> & {
  size?: "default" | "compact";
};

function SearchField({ className, size, ...props }: SearchFieldProps) {
  return (
    <div data-slot="search-field" className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        className={cn(searchFieldVariants({ size }), className)}
        {...props}
      />
    </div>
  );
}

export { SearchField };
export type { SearchFieldProps };
