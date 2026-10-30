import { MousePointerClick } from "lucide-react";

export function EmptyCanvasHint() {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <div className="glass flex max-w-sm flex-col items-center gap-3 rounded-xl px-8 py-6 text-center">
        <MousePointerClick className="size-8 text-primary" />
        <div className="font-serif text-lg font-semibold">从空白画布开始</div>
        <p className="text-sm text-muted-foreground">
          从左侧模块库拖入 nf-core 模块，连接输入输出，搭建你的流程。
        </p>
      </div>
    </div>
  );
}
