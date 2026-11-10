import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { WORKSPACE_LIMITS as L, type Workspace } from '../shared/workspace';

export interface WorkspaceStore {
  /** The saved workspace, or null when there is none (or it was unreadable). */
  load(): Promise<Workspace | null>;
  save(workspace: Workspace): Promise<void>;
}

const tabState = z
  .object({
    mode: z.enum(['builder', 'raw']),
    rows: z
      .array(
        z
          .object({
            join: z.enum(['and', 'or']),
            field: z.string().max(L.maxFieldLength),
            op: z.string().max(20),
            value: z.string().max(L.maxValueLength),
          })
          .strict(),
      )
      .max(L.maxRows),
    raw: z.string().max(L.maxRawLength),
    rawEdited: z.boolean(),
    sortId: z.string().max(20),
    limit: z.number().int().min(1).max(1000),
  })
  .strict();

export const workspaceSchema = z
  .object({
    version: z.literal(1),
    tabs: z
      .array(
        z
          .object({
            connectionId: z.uuid(),
            db: z.string().min(1).max(63),
            collection: z.string().min(1).max(255),
            state: tabState,
          })
          .strict(),
      )
      .max(L.maxTabs),
    activeIndex: z.number().int().min(0),
  })
  .strict();

/**
 * workspace.json in the data folder. Holds query text (which can include values typed into
 * filters), never connection strings. Writes are atomic and serialized, so a crash or two quick
 * saves never leave a half-written file.
 */
export class FileWorkspaceStore implements WorkspaceStore {
  private readonly file: string;
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly dir: string,
    private readonly log: (message: string) => void = (m) => console.error(m),
  ) {
    this.file = path.join(dir, 'workspace.json');
  }

  async load(): Promise<Workspace | null> {
    // Wait for pending saves, so a load right after a save (e.g. a page reload) sees it.
    await this.writeQueue;
    let text: string;
    try {
      text = await fs.readFile(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    try {
      return workspaceSchema.parse(JSON.parse(text));
    } catch {
      // Unreadable (edited by hand, or from a newer version): start fresh, but keep a copy aside
      // instead of overwriting it on the next save.
      const aside = path.join(this.dir, 'workspace.unreadable.json');
      await fs.rename(this.file, aside).catch(() => undefined);
      this.log(`Saved tabs could not be read; moved to ${aside}`);
      return null;
    }
  }

  save(workspace: Workspace): Promise<void> {
    const run = this.writeQueue.then(async () => {
      await fs.mkdir(this.dir, { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify(workspace)}\n`, 'utf8');
      await fs.rename(tmp, this.file);
    });
    this.writeQueue = run.catch(() => undefined);
    return run;
  }
}
