import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, safeStorage } from "electron";

import { type Connection, type ConnectionStore, readStore } from "../../src/features/desktop/connections";

/**
 * Saved connections in `<userData>/connections.json`; tokens of URL connections separately in
 * `connection-tokens.json`, encrypted with safeStorage when the system keychain is available (0600 file otherwise).
 */
const storeFile = () => join(app.getPath("userData"), "connections.json");
const tokenFile = () => join(app.getPath("userData"), "connection-tokens.json");

export function loadConnections(): ConnectionStore {
  try { return readStore(JSON.parse(readFileSync(storeFile(), "utf8"))); }
  catch { return { connections: [] }; }
}

function saveStore(store: ConnectionStore) {
  writeFileSync(storeFile(), `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
}

export function saveConnection(connection: Connection, token?: string): ConnectionStore {
  const store = loadConnections();
  const connections = [connection, ...store.connections.filter((item) => item.id !== connection.id)];
  const next = { ...store, connections };
  saveStore(next);
  if (token !== undefined) setToken(connection.id, token);
  return next;
}

export function removeConnection(id: string): ConnectionStore {
  const store = loadConnections();
  const next = { last: store.last === id ? undefined : store.last, connections: store.connections.filter((item) => item.id !== id) };
  saveStore(next);
  setToken(id, undefined);
  return next;
}

export function rememberLast(id: string) {
  const store = loadConnections();
  if (store.connections.some((item) => item.id === id)) saveStore({ ...store, last: id });
}

type Tokens = Record<string, { encrypted: boolean; value: string }>;

function readTokens(): Tokens {
  if (!existsSync(tokenFile())) return {};
  try { return JSON.parse(readFileSync(tokenFile(), "utf8")) as Tokens; } catch { return {}; }
}

const canEncrypt = () => safeStorage.isEncryptionAvailable() && !(process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text");

function setToken(id: string, token: string | undefined) {
  const tokens = readTokens();
  if (token) tokens[id] = canEncrypt() ? { encrypted: true, value: safeStorage.encryptString(token).toString("base64") } : { encrypted: false, value: token };
  else delete tokens[id];
  writeFileSync(tokenFile(), `${JSON.stringify(tokens)}\n`, { mode: 0o600 });
}

export function connectionToken(id: string): string | undefined {
  const saved = readTokens()[id];
  if (!saved) return undefined;
  try { return saved.encrypted ? safeStorage.decryptString(Buffer.from(saved.value, "base64")) : saved.value; }
  catch { return undefined; }
}
