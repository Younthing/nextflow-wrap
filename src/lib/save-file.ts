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
