/**
 * Diagnostics bundles are attached to bug reports, so anything that looks like a credential is masked before a
 * file goes in: values of secret-named variables, known API key shapes, and URL passwords.
 */
const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)/i;
const KEY_SHAPES = [
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/g,
];
export const MASK = "‹已隐藏›";

export const secretName = (name: string) => SECRET_NAME.test(name);

/** Environment variables safe to show: secret-named ones are masked, the rest kept as is. */
export function redactEnv(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => [name, secretName(name) && value ? MASK : redactText(value)]),
  );
}

/** Masks known secrets and key-shaped strings in free text such as logs and configs. */
export function redactText(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) if (secret.length >= 8) out = out.split(secret).join(MASK);
  for (const shape of KEY_SHAPES) out = out.replace(shape, MASK);
  out = out.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, `$1${MASK}@`);
  out = out.replace(/^(\s*(?:export\s+)?[A-Za-z_][\w.]*?(?:KEY|TOKEN|SECRET|PASSWORD)\w*\s*[=:]\s*)(\S.*)$/gim, `$1${MASK}`);
  return out;
}
