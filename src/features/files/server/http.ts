import { listDirectory } from "./list";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });

/** `/api/fs/list?path=`: folder listing for the web path picker. Only same-origin pages may read it. */
export async function handleFsApi(method: string, path: string[], request: Request): Promise<Response> {
  if (method !== "GET" || path[1] !== "list") return json({ message: "接口不存在" }, 404);
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return json({ message: "不允许跨站读取本机目录" }, 403);
  const url = new URL(request.url);
  return json(await listDirectory(url.searchParams.get("path"), { showHidden: url.searchParams.get("hidden") === "1" }));
}
