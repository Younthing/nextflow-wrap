import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";

import {
  SortHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type TableSortDirection,
} from "../table";

const meta = { title: "UI/Table", component: Table, args: {} } satisfies Meta<
  typeof Table
>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Static: Story = {
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>名称</TableHead>
          <TableHead>更新时间</TableHead>
          <TableHead>最近运行</TableHead>
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>
            <div className="font-medium">rnaseq</div>
            <div className="text-xs text-muted-foreground">RNA 测序</div>
          </TableCell>
          <TableCell className="whitespace-nowrap text-muted-foreground">
            今天 09:12
          </TableCell>
          <TableCell>成功</TableCell>
          <TableCell className="text-right">打开</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>
            <div className="font-medium">sarek</div>
            <div className="text-xs text-muted-foreground">变异检测</div>
          </TableCell>
          <TableCell className="whitespace-nowrap text-muted-foreground">
            昨天 18:40
          </TableCell>
          <TableCell>运行中</TableCell>
          <TableCell className="text-right">打开</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
};

const initialSort = {
  name: "asc",
  status: "desc",
  started: false,
} as const satisfies Record<string, TableSortDirection>;

function nextDirection(direction: TableSortDirection): TableSortDirection {
  if (direction === "asc") return "desc";
  if (direction === "desc") return false;
  return "asc";
}

function ariaSort(
  direction: TableSortDirection,
): "ascending" | "descending" | "none" {
  if (direction === "asc") return "ascending";
  if (direction === "desc") return "descending";
  return "none";
}

function SortableTable() {
  const [sorting, setSorting] = React.useState<
    Record<keyof typeof initialSort, TableSortDirection>
  >(initialSort);

  function toggle(column: keyof typeof initialSort) {
    setSorting((current) => ({
      ...current,
      [column]: nextDirection(current[column]),
    }));
  }

  const columns = [
    ["name", "名称"],
    ["status", "状态"],
    ["started", "开始时间"],
  ] as const;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map(([column, label]) => (
            <TableHead key={column} aria-sort={ariaSort(sorting[column])}>
              <SortHeader
                direction={sorting[column]}
                onClick={() => toggle(column)}
              >
                {label}
              </SortHeader>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="font-medium">rnaseq</TableCell>
          <TableCell>成功</TableCell>
          <TableCell className="whitespace-nowrap text-muted-foreground">
            今天 09:12
          </TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">sarek</TableCell>
          <TableCell>运行中</TableCell>
          <TableCell className="whitespace-nowrap text-muted-foreground">
            昨天 18:40
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

export const Sortable: Story = {
  render: () => <SortableTable />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("columnheader", { name: "名称" }),
    ).toHaveAttribute("aria-sort", "ascending");
    await expect(
      canvas.getByRole("columnheader", { name: "状态" }),
    ).toHaveAttribute("aria-sort", "descending");
    const started = canvas.getByRole("columnheader", { name: "开始时间" });
    await expect(started).toHaveAttribute("aria-sort", "none");
    await userEvent.click(canvas.getByRole("button", { name: "开始时间" }));
    await expect(started).toHaveAttribute("aria-sort", "ascending");
  },
};

export const LongContent: Story = {
  render: () => (
    <Table className="max-w-xl table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead>名称</TableHead>
          <TableHead>结果路径</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="align-top">
            <div className="truncate font-medium">studio/scrna</div>
            <div className="text-xs text-muted-foreground">
              使用 STAR、Salmon 或 HISAT2 做比对和定量，并输出基因计数、转录本计数和
              MultiQC 报告。这条说明故意写得很长，用来确认单元格在固定表格宽度里换行。
            </div>
          </TableCell>
          <TableCell className="align-top break-all font-mono text-xs text-muted-foreground">
            /data/projects/studio/scrna/results/summary_report/summary_report.html
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
};
