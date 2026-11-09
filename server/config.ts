import os from 'node:os';
import path from 'node:path';

export const APP_NAME = 'aye-aye';
export const DEFAULT_PORT = 4317;

/** Hard limits applied to every query, regardless of what the UI sends. */
export const QUERY_LIMITS = {
  maxLimit: 200,
  maxSkip: 1_000_000,
  maxTimeMS: 15_000,
  sampleSize: 100,
  maxFilterLength: 20_000,
  maxFilterDepth: 32,
} as const;

/**
 * Per-user config directory (non-secret metadata only; secrets live in the OS keychain).
 * Windows: %APPDATA%\aye-aye
 */
export function appDataDir(): string {
  // Override for tests and smoke checks, so they never see the real connections.
  if (process.env.AYE_AYE_DATA_DIR) return path.resolve(process.env.AYE_AYE_DATA_DIR);
  const base =
    process.env.APPDATA ??
    (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : (process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config')));
  return path.join(base, APP_NAME);
}

const MAX_APP_NAME_BYTES = 128; // MongoDB's limit for the client appName

function currentUser(): string {
  try {
    return os.userInfo().username;
  } catch {
    return process.env.USERNAME ?? process.env.USER ?? 'unknown';
  }
}

/**
 * The name database admins see for our connections (db.currentOp(), server logs, profiler),
 * e.g. "Aye-aye (local MongoDB query tool) jane.doe@LAPTOP-42": says what the tool is
 * and who runs it, so nobody mistakes it for a production service.
 */
export function clientAppName(user: string = currentUser(), host: string = os.hostname()): string {
  const clean = (s: string) => s.replace(/[^\w.@-]/g, '').slice(0, 40) || 'unknown';
  return Buffer.from(`Aye-aye (local MongoDB query tool) ${clean(user)}@${clean(host)}`)
    .subarray(0, MAX_APP_NAME_BYTES)
    .toString();
}

export function resolvePort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`AYE_AYE_PORT must be an integer between 1024 and 65535 (got "${raw}")`);
  }
  return port;
}
