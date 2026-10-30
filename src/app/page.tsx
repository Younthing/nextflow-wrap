import { EmptyCanvasHint } from "@/components/editor/empty-canvas-hint";
import { FlowCanvas } from "@/components/editor/flow-canvas";

export default function EditorPage() {
  return (
    <section className="glass relative size-full overflow-hidden rounded-xl">
      <FlowCanvas />
      <EmptyCanvasHint />
    </section>
  );
}
