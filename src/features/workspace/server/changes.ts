import { watch } from "node:fs";
import { retainProject } from "./project-leases";

/** One stream per open window. No execution-cache events or file contents cross it. */
export function projectChanges(root: string, signal: AbortSignal, project: string): Response {
  const encoder = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const paths = new Set<string>();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const send = (value: unknown) => { if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`)); };
      const watcher = watch(root, { recursive: true }, (_event, filename) => {
        const path = filename?.toString().replaceAll("\\", "/");
        if (!path || path.startsWith(".studio/") || path.startsWith(".git/") || path.includes(".tmp-") || path.endsWith(".studio-lock")) return;
        paths.add(path);
        timer ??= setTimeout(() => { send({ paths: [...paths] }); paths.clear(); timer = undefined; }, 150);
      });
      const release = retainProject(project);
      const heartbeat = setInterval(() => send({ paths: [] }), 20_000);
      stop = () => {
        if (closed) return;
        closed = true;
        watcher.close();
        release();
        clearInterval(heartbeat);
        clearTimeout(timer);
        signal.removeEventListener("abort", stop);
        controller.close();
      };
      watcher.on("error", stop);
      signal.addEventListener("abort", stop, { once: true });
      send({ refresh: true });
      if (signal.aborted) stop();
    },
    cancel() { stop(); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
}
