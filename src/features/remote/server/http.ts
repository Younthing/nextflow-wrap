import { applyStoredSettings, readSettings, remoteHostSchema } from "@/lib/server/settings";
import type { RemoteHost } from "../types";
import { probeHost } from "./remote-run";
import { SshSession } from "./session";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });

/**
 * `POST /api/remotes/test`: connects to a host (saved or still being edited) and reports what it found.
 * The answer is a probe even when ssh fails, so the form can show the reason next to the host.
 */
export async function handleRemoteApi(method: string, path: string[], request: Request): Promise<Response> {
  if (method === "POST" && path[1] === "test" && !path[2]) {
    const host = remoteHostSchema.parse(await request.json()) as RemoteHost;
    applyStoredSettings();
    try {
      return json(await probeHost(new SshSession(host)));
    } catch (error) {
      return json({ ok: false, schedulers: [], runtimes: [], error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (method === "GET" && !path[1]) return json(readSettings().remotes);
  return json({ message: "接口不存在" }, 404);
}
