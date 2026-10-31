"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { cn } from "@/lib/utils";

/** Unsorted is `false`, matching TanStack Table `column.getIsSorted()`. */
export type TableSortDirection = "asc" | "desc" | false;

const TableSectionContext = React.createContext<"header" | "body">("body");

const tableRowClass = {
  header: "border-b border-border/60 text-left text-xs text-muted-foreground",
  body: "border-b border-border/40 transition-colors last:border-0 hover:bg-accent/50",
} as const;

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <table
      data-slot="table"
      className={cn("w-full text-sm", className)}
      {...props}
    />
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <TableSectionContext.Provider value="header">
      <thead data-slot="table-header" className={className} {...props} />
    </TableSectionContext.Provider>
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <TableSectionContext.Provider value="body">
      <tbody data-slot="table-body" className={className} {...props} />
    </TableSectionContext.Provider>
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  const section = React.useContext(TableSectionContext);

  return (
    <tr
      data-slot="table-row"
      className={cn(tableRowClass[section], className)}
      {...props}
    />
  );
}

function TableHead({
  className,
  scope = "col",
  ...props
}: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      scope={scope}
      className={cn("px-3 py-2 text-left font-medium", className)}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn("px-3 py-2.5 align-middle", className)}
      {...props}
    />
  );
}

function SortHeader({
  direction,
  className,
  type = "button",
  children,
  ...props
}: React.ComponentProps<"button"> & {
  direction: TableSortDirection;
}) {
  const Icon =
    direction === "asc"
      ? ArrowUp
      : direction === "desc"
        ? ArrowDown
        : ArrowUpDown;

  return (
    <button
      type={type}
      data-slot="sort-header"
      className={cn(
        "group flex items-center gap-1 hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <Icon
        aria-hidden="true"
        className={cn(
          "size-3",
          direction === false && "opacity-0 group-hover:opacity-60",
        )}
      />
    </button>
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  SortHeader,
};
