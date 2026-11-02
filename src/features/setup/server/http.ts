import { z } from "zod";
import { setupStatus, startInstall } from "./setup";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
const installSchema = z.object({ tool: z.enum(["java", "nextflow", "weblog", "conda", "jupyter", "docker"]) });

/** `/api/setup`: tool checks for the first-run wizard and one-click installs. */
export async function handleSetupApi(method: string, path: string[], request: Request): Promise<Response> {
  const [, action] = path;
  if (!action && method === "GET") return json(await setupStatus());
  if (action === "install" && method === "POST") {
    const { tool } = installSchema.parse(await request.json());
    const result = startInstall(tool);
    return json(result, result.started ? 202 : 409);
  }
  return json({ message: "接口不存在" }, 404);
}
