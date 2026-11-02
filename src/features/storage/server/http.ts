import { z } from "zod";
import { cleanSession, storageReport } from "./storage";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });

/** `/api/storage`: disk usage per Nextflow session and per cache; `POST /api/storage/sessions/:key/clean`. */
export async function handleStorageApi(method: string, path: string[], request: Request): Promise<Response> {
  const [, collection, key, action] = path;
  if (!collection && method === "GET") return json(await storageReport());
  if (collection === "sessions" && key && action === "clean" && method === "POST") {
    const body = z.object({ results: z.boolean().optional() }).parse(await request.json().catch(() => ({})));
    return json(await cleanSession(decodeURIComponent(key), body));
  }
  return json({ message: "接口不存在" }, 404);
}
