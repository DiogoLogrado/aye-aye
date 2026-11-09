import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

export const TOKEN_HEADER = 'x-aye-aye-token';
export const TOKEN_PLACEHOLDER = '__AYE_AYE_TOKEN__';

/** Fresh random token per server start; only the page served by this process knows it. */
export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function injectToken(html: string, token: string): string {
  return html.replaceAll(TOKEN_PLACEHOLDER, token);
}

function allowedHosts(port: number): Set<string> {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
}

/**
 * Rejects requests whose Host header isn't this server.
 * Blocks DNS-rebinding attacks where a malicious site resolves its domain to 127.0.0.1.
 */
export function hostGuard(port: number): RequestHandler {
  const hosts = allowedHosts(port);
  return (req, res, next) => {
    if (!hosts.has(req.headers.host ?? '')) {
      res.status(403).type('text/plain').send('Forbidden host');
      return;
    }
    next();
  };
}

/** Rejects cross-site API calls (other tabs/sites trying to reach localhost). */
export function originGuard(port: number): RequestHandler {
  const origins = new Set([...allowedHosts(port)].map((h) => `http://${h}`));
  return (req, res, next) => {
    const origin = req.headers.origin;
    const fetchSite = req.headers['sec-fetch-site'];
    if ((origin !== undefined && !origins.has(origin)) || (fetchSite !== undefined && fetchSite !== 'same-origin')) {
      res.status(403).json({ error: 'Cross-origin requests are not allowed' });
      return;
    }
    next();
  };
}

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Requires the per-session token on every API call (constant-time comparison). */
export function tokenGuard(token: string): RequestHandler {
  const expected = digest(token);
  return (req, res, next) => {
    const provided = req.headers[TOKEN_HEADER];
    if (typeof provided !== 'string' || !timingSafeEqual(digest(provided), expected)) {
      res.status(401).json({ error: 'Session expired. Reload the page.' });
      return;
    }
    next();
  };
}

export function contentSecurityPolicy(isProd: boolean, port: number): Record<string, string[]> {
  const self = "'self'";
  return {
    'default-src': [self],
    // Vite's dev server injects an inline React-refresh preamble and inline styles; prod is strict.
    'script-src': isProd ? [self] : [self, "'unsafe-inline'"],
    'style-src': isProd ? [self] : [self, "'unsafe-inline'"],
    'img-src': [self, 'data:'],
    'connect-src': isProd ? [self] : [self, `ws://localhost:${port}`, `ws://127.0.0.1:${port}`],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
    'frame-ancestors': ["'none'"],
  };
}
