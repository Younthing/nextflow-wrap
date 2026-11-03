import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, safeStorage } from "electron";

import { type Connection, connectionKey, type ConnectionStore, readStore } from "../../src/features/desktop/connections";

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

/**
 * Saves `connection` first in the list. A saved entry for the same backend (same distro, ssh target or address)
 * keeps its id, so connecting again never adds a duplicate. Returns the connection as saved.
 */
export function saveConnection(connection: Connection, token?: string): Connection {
  const store = loadConnections();
  const known = store.connections.find((item) => item.id === connection.id || connectionKey(item) === connectionKey(connection));
  const saved = known ? { ...connection, id: known.id } : connection;
  const connections = [saved, ...store.connections.filter((item) => item.id !== saved.id)];
  saveStore({ ...store, connections });
  if (token !== undefined) setToken(saved.id, token);
  return saved;
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
