/* Text the chat composer inserts; kept apart from the CopilotKit components so it tests without a DOM. */

/** Puts `token` at the end of the draft with one space on each side, the way a mention is inserted. */
export function insertToken(draft: string, token: string): string {
  if (!draft) return `${token} `;
  return /\s$/.test(draft) ? `${draft}${token} ` : `${draft} ${token} `;
}

/** A name wrapped for the chat, e.g. `df`; the notebook prompt reads backticked names as variables. */
export const codeReference = (name: string) => `\`${name}\``;
