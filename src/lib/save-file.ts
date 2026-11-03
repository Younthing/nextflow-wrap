/** Save text or bytes as a file through the browser's download flow (the desktop shell shows its own save dialog). */
export function saveTextFile(name: string, type: string, content: string | Uint8Array<ArrayBuffer>) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  // Give the download a moment to start before the URL goes away.
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/**
 * Save a file the server sends with `content-disposition: attachment`. The demo answers from a service worker,
 * which a plain link would bypass, so there the bytes are fetched first.
 */
export async function saveUrl(url: string, name: string, viaFetch: boolean) {
  if (viaFetch) {
    const res = await fetch(url);
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? res.statusText);
    saveTextFile(name, res.headers.get("content-type") ?? "application/octet-stream", new Uint8Array(await res.arrayBuffer()));
    return;
  }
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
}
