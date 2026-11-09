// Terminal entry point: `npm start` (prod build) or `npm run dev` (Vite hot reload).
// The desktop app uses startServer() directly (see electron/main.ts).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePort } from './config';
import { startServer } from './start';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN_NODE = [20, 19] as const; // required by mongodb@7

function assertNodeVersion(): void {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
    throw new Error(
      `Aye-aye needs Node ${MIN_NODE.join('.')}+ (running ${process.versions.node}). ` +
        'This project pins Node 24 in .nvmrc. Run "fnm use" in the project folder, then start again.',
    );
  }
}

async function main(): Promise<void> {
  assertNodeVersion();
  const isProd = process.argv.includes('--prod');
  const port = resolvePort(process.env.AYE_AYE_PORT);

  let server;
  try {
    server = await startServer({ port, isProd, clientDir: path.join(projectDir, 'dist', 'client'), projectDir });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      throw new Error(`Port ${port} is already in use. Is Aye-aye already running? Set AYE_AYE_PORT to use another port.`);
    }
    throw error;
  }
  console.log(`Aye-aye ${isProd ? '' : '(dev) '}running at ${server.url}`);

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
