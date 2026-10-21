import { constants, type Dirent } from "node:fs";
import { open, opendir, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { formatForPath } from "../shared/formats";
import { MAX_LISTED_FILES, MAX_SCANNED_DIRECTORIES } from "../shared/limits";
import type { ModelFile } from "../shared/rpc";

const WORKSPACE_PAGE_SIZE = 200;
const MAX_WORKSPACE_PAGES = 50;

// Never descended into while listing: dependency trees, VCS data and build output.
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "build", "out", "target", "__pycache__", "venv"]);

export async function workspaceRoot(paseo: PluginHandlerContext["paseo"], workspaceId: string): Promise<string> {
  let cursor: string | undefined;
  for (let page = 0; page < MAX_WORKSPACE_PAGES; page++) {
    const result = await paseo.workspaces.list({
      filter: { query: workspaceId },
      page: { limit: WORKSPACE_PAGE_SIZE, ...(cursor ? { cursor } : {}) },
    });
    const workspace = result.entries.find((entry) => entry.id === workspaceId);
    if (workspace) {
      const directory = workspace.workspaceDirectory || workspace.projectRootPath;
      if (!directory) throw new Error("This workspace has no directory on the daemon host.");
      return realpath(directory);
    }
    const next = result.pageInfo?.nextCursor ?? undefined;
    if (!result.pageInfo?.hasMore || !next || next === cursor) break;
    cursor = next;
  }
  throw new Error(`Workspace ${workspaceId} was not found on this host.`);
}

function contains(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

/**
 * Resolves a workspace-relative (or absolute) path to a real path inside the workspace,
 * following symlinks first so a link cannot escape the root.
 */
export async function resolveInside(root: string, path: string): Promise<string> {
  const absolute = isAbsolute(path);
  const lexical = absolute ? resolve(path) : resolve(root, path);
  // Absolute paths (file panels) may name the workspace through a symlinked parent, so
  // only the realpath check below decides for them.
  if (!absolute && !contains(root, lexical)) throw new Error("The file is outside this workspace.");
  const real = await realpath(lexical).catch((error: NodeJS.ErrnoException) => {
    // Do not reveal whether paths outside the workspace exist.
    if (!contains(root, lexical)) throw new Error("The file is outside this workspace.");
    if (error.code === "ENOENT" || error.code === "ENOTDIR") throw new Error(`File not found: ${path}`);
    throw error;
  });
  if (!contains(root, real)) throw new Error("The file is outside this workspace.");
  return real;
}

export interface ReadModel {
  path: string;
  relativePath: string;
  bytes: Uint8Array;
  modifiedMs: number;
}

/**
 * Reads a regular file at an already-resolved path. O_NONBLOCK so a FIFO is rejected by
 * the isFile check instead of hanging a threadpool thread; O_NOFOLLOW so a symlink swapped
 * in after resolveInside is refused. Reads exactly the size that passed `checkSize`, so a
 * file growing meanwhile cannot exceed the limit.
 */
async function readRegularFile(resolved: string, checkSize: (size: number) => void) {
  const handle = await open(resolved, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("Only regular files can be opened.");
    checkSize(info.size);
    const bytes = new Uint8Array(info.size);
    let read = 0;
    while (read < bytes.length) {
      const { bytesRead } = await handle.read(bytes, read, bytes.length - read, read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    return { bytes: read === bytes.length ? bytes : bytes.subarray(0, read), modifiedMs: info.mtimeMs };
  } finally {
    await handle.close();
  }
}

/** Reads a supported model file inside the workspace; `checkSize` throws when too large. */
export async function readModelFile(root: string, path: string, checkSize: (size: number) => void): Promise<ReadModel> {
  const resolved = await resolveInside(root, path);
  if (!formatForPath(resolved)) throw new Error("This file type is not a supported 3D format.");
  const { bytes, modifiedMs } = await readRegularFile(resolved, checkSize);
  return { path: resolved, relativePath: toPosix(relative(root, resolved)), bytes, modifiedMs };
}

/** Reads a file a glTF references, constrained to the workspace like the model itself. */
export async function readSibling(root: string, modelPath: string, uri: string, maxBytes: number): Promise<Uint8Array> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    throw new Error(`glTF resource ${uri} is not a valid URI.`);
  }
  if (isAbsolute(decoded) || /^[a-z][a-z0-9+.-]*:/i.test(decoded)) {
    throw new Error(`glTF resource ${uri} is not a relative path.`);
  }
  const resolved = await resolveInside(root, join(dirname(modelPath), decoded));
  const { bytes } = await readRegularFile(resolved, (size) => {
    if (size > maxBytes) throw new Error("This glTF file and its resources exceed the viewer's size limit.");
  });
  return bytes;
}

/** Breadth-first scan for supported models, skipping hidden and dependency directories. */
export async function listModels(root: string): Promise<{ files: ModelFile[]; truncated: boolean }> {
  const files: ModelFile[] = [];
  const queue = [root];
  let scanned = 0;
  let truncated = false;
  while (queue.length > 0) {
    if (scanned++ >= MAX_SCANNED_DIRECTORIES) {
      truncated = true;
      break;
    }
    const directory = queue.shift()!;
    let entries: Dirent[];
    try {
      entries = [];
      for await (const entry of await opendir(directory)) entries.push(entry);
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) queue.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const info = formatForPath(entry.name);
      if (!info) continue;
      if (files.length >= MAX_LISTED_FILES) {
        truncated = true;
        break;
      }
      const details = await stat(full).catch(() => null);
      if (!details) continue;
      files.push({
        path: toPosix(relative(root, full)),
        size: details.size,
        modifiedMs: details.mtimeMs,
        format: info.format,
      });
    }
    if (truncated) break;
  }
  return { files, truncated };
}


function toPosix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}
