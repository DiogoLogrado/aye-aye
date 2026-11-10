import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import express, { type RequestHandler } from 'express';
import { createApp } from './app';
import { BackupStore } from './backupStore';
import { appDataDir } from './config';
import { KeyringConnectionStore } from './connectionStore';
import { MongoService } from './mongoService';
import { createSessionToken, injectToken } from './security';
import { FileWorkspaceStore } from './workspaceStore';
import { WriteService } from './writeService';

export const HOST = '127.0.0.1'; // loopback only: never reachable from the network

export interface StartOptions {
  /** Port to listen on; 0 picks a free one. */
  port: number;
  /** When the preferred port is taken, fall back to a free one instead of failing (used by the desktop app). */
  fallbackToFreePort?: boolean;
  /** Serve the prebuilt client from `clientDir` (true) or run Vite with hot reload from `projectDir` (false). */
  isProd: boolean;
  /** Folder containing the built client (index.html + assets). Required when isProd. */
  clientDir?: string;
  /** Project root, for Vite in development. Required when !isProd. */
  projectDir?: string;
  /** Where connections metadata and backups live. Defaults to %APPDATA%\aye-aye. */
  dataDir?: string;
}

export interface RunningServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

function listen(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve((server.address() as AddressInfo).port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, HOST);
  });
}

/**
 * Starts Aye-aye (API + UI) on 127.0.0.1. Shared by the terminal entry point and the
 * desktop app. The port is bound before the app is built, because the security guards
 * (Host/Origin checks, CSP) need the real port, which matters when a free port is picked.
 */
export async function startServer(options: StartOptions): Promise<RunningServer> {
  const dataDir = options.dataDir ?? appDataDir();
  const server = http.createServer();

  let port: number;
  try {
    port = await listen(server, options.port);
  } catch (error) {
    if (!options.fallbackToFreePort || (error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    port = await listen(server, 0);
  }

  const token = createSessionToken();
  const store = new KeyringConnectionStore(dataDir);
  const mongo = new MongoService(store);
  const backups = new BackupStore(path.join(dataDir, 'backups'));
  const writes = new WriteService((id, db, coll) => mongo.collection(id, db, coll), store, backups);
  const workspace = new FileWorkspaceStore(dataDir);
  const app = createApp({ port, token, isProd: options.isProd, store, mongo, writes, workspace, verifyUri: MongoService.verify });

  const sendHtml = (html: string, res: express.Response) =>
    res.set('Cache-Control', 'no-store').type('html').send(injectToken(html, token));

  let closeVite: (() => Promise<void>) | undefined;
  try {
    if (options.isProd) {
      const clientDir = options.clientDir;
      if (!clientDir) throw new Error('clientDir is required in production mode');
      const html = await fs.readFile(path.join(clientDir, 'index.html'), 'utf8').catch(() => {
        throw new Error('Client build not found. Run "npm run build" first.');
      });
      app.use(express.static(clientDir, { index: false }));
      app.get('/{*path}', (_req, res) => sendHtml(html, res));
    } else {
      const projectDir = options.projectDir;
      if (!projectDir) throw new Error('projectDir is required in development mode');
      const { createServer } = await import('vite');
      const vite = await createServer({
        configFile: path.join(projectDir, 'vite.config.ts'),
        server: { middlewareMode: true, hmr: { server } },
        appType: 'custom',
      });
      closeVite = () => vite.close();
      app.use(vite.middlewares);
      const serveIndex: RequestHandler = async (req, res, next) => {
        try {
          const template = await fs.readFile(path.join(projectDir, 'client', 'index.html'), 'utf8');
          sendHtml(await vite.transformIndexHtml(req.originalUrl, template), res);
        } catch (error) {
          next(error);
        }
      };
      app.get('/{*path}', serveIndex);
    }
  } catch (error) {
    server.close();
    throw error;
  }

  server.on('request', app);

  let closing: Promise<void> | undefined;
  return {
    url: `http://${HOST}:${port}`,
    port,
    close: () =>
      (closing ??= (async () => {
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        });
        await Promise.allSettled([mongo.closeAll(), closeVite?.()]);
      })()),
  };
}
