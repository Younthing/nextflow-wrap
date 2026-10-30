/** Remove active markup before placing a report in an additional sandboxed iframe. */
export function staticReportHtml(source: string): string {
  const document = new DOMParser().parseFromString(source, "text/html");
  for (const element of document.querySelectorAll("script, iframe, object, embed, base")) element.remove();
  for (const element of document.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name) || /^javascript:/i.test(attribute.value.trim())) element.removeAttribute(attribute.name);
    }
  }
  return `<!doctype html>${document.documentElement.outerHTML}`;
}
