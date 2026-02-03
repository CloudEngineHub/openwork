import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { minimatch } from "minimatch";
import type { SandboxInfo, SandboxStatus, TargetInfo, WorkspaceInfo } from "./types.js";
import { ensureDir, exists, shortId } from "./utils.js";

type SandboxState = {
  version: number;
  activeId: string;
  sandboxes: SandboxInfo[];
};

export type SandboxStore = {
  baseWorkspace: WorkspaceInfo;
  target: TargetInfo;
  root: string;
  statePath: string;
  state: SandboxState;
};

type SandboxCreateMode = "base" | "sandbox";

type SandboxCreateOptions = {
  name?: string | null;
  source: { type: SandboxCreateMode; id?: string | null };
};

const DEFAULT_SANDBOX_NAME = "Sandbox";
const SANDBOX_STATE_VERSION = 1;
const DEFAULT_IGNORE_PATTERNS = [
  ".git",
  ".git/**",
  ".openwork/sandboxes",
  ".openwork/sandboxes/**",
  "node_modules",
  "node_modules/**",
  ".DS_Store",
];

const toPosix = (value: string) => value.replace(/\\/g, "/");

const normalizePattern = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const negated = trimmed.startsWith("!");
  const body = (negated ? trimmed.slice(1) : trimmed).trim();
  if (!body) return null;
  let normalized = toPosix(body);
  if (normalized.startsWith("/")) normalized = normalized.slice(1);
  if (normalized.endsWith("/")) normalized = `${normalized}**`;
  return negated ? `!${normalized}` : normalized;
};

const parseIgnoreFile = async (path: string) => {
  try {
    const raw = await readFile(path, "utf8");
    return raw
      .split(/\r?\n/)
      .map(normalizePattern)
      .filter((entry): entry is string => Boolean(entry));
  } catch {
    return [];
  }
};

const buildIgnoreMatcher = async (root: string) => {
  const sandboxIgnore = join(root, ".openwork", "sandbox-ignore");
  const gitIgnore = join(root, ".gitignore");
  const patterns = (await parseIgnoreFile(sandboxIgnore)).length
    ? await parseIgnoreFile(sandboxIgnore)
    : await parseIgnoreFile(gitIgnore);
  const merged = [...DEFAULT_IGNORE_PATTERNS, ...patterns];

  return (relPath: string) => {
    const normalized = toPosix(relPath);
    let ignored = false;
    for (const pattern of merged) {
      const negated = pattern.startsWith("!");
      const body = negated ? pattern.slice(1) : pattern;
      if (!body) continue;
      if (minimatch(normalized, body, { dot: true, matchBase: true })) {
        ignored = !negated;
      }
    }
    return ignored;
  };
};

const ensureSandboxRoot = async (baseWorkspacePath: string) => {
  const root = join(baseWorkspacePath, ".openwork", "sandboxes");
  await ensureDir(root);
  return root;
};

const sandboxStatePath = (root: string) => join(root, "sandboxes.json");

const nowMs = () => Date.now();

const ensureBaseSandbox = (state: SandboxState, baseWorkspace: WorkspaceInfo, target: TargetInfo) => {
  const existing = state.sandboxes.find((entry) => entry.id === baseWorkspace.id);
  if (existing) return;
  const createdAt = nowMs();
  state.sandboxes.push({
    id: baseWorkspace.id,
    name: baseWorkspace.name || "Default",
    targetId: target.id,
    baseWorkspaceId: baseWorkspace.id,
    path: baseWorkspace.path,
    createdAt,
    updatedAt: createdAt,
    status: "active",
  });
  if (!state.activeId) state.activeId = baseWorkspace.id;
};

export const deriveSandboxStatus = (sandbox: SandboxInfo, activeId: string): SandboxStatus => {
  if (sandbox.status === "archived") return "archived";
  if (sandbox.id === activeId) return "active";
  return "idle";
};

const runCommand = async (command: string, args: string[], cwd: string) => {
  return new Promise<{ ok: boolean; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(command, args, { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk ?? "");
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk ?? "");
    });
    child.on("error", (error) => {
      stderr += String(error ?? "");
      resolve({ ok: false, stdout, stderr });
    });
    child.on("exit", (code) => {
      resolve({ ok: code === 0, stdout, stderr });
    });
  });
};

const resolveGitRoot = async (root: string) => {
  const result = await runCommand("git", ["rev-parse", "--show-toplevel"], root);
  if (!result.ok) return null;
  const trimmed = result.stdout.trim();
  return trimmed ? resolve(trimmed) : null;
};

const isGitClean = async (root: string) => {
  const result = await runCommand("git", ["status", "--porcelain"], root);
  if (!result.ok) return false;
  return result.stdout.trim().length === 0;
};

const attemptWorktree = async (root: string, dest: string) => {
  const result = await runCommand("git", ["worktree", "add", "--detach", dest, "HEAD"], root);
  return result.ok;
};

const attemptClone = async (root: string, dest: string) => {
  const result = await runCommand("git", ["clone", "--depth", "1", root, dest], root);
  return result.ok;
};

const copyWorkspace = async (
  sourceRoot: string,
  source: string,
  dest: string,
  ignore: (rel: string) => boolean,
) => {
  await ensureDir(dest);
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(source, entry.name);
    const relPath = toPosix(relative(sourceRoot, srcPath));
    if (ignore(relPath)) continue;
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyWorkspace(sourceRoot, srcPath, destPath, ignore);
      continue;
    }
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isFile()) {
      await ensureDir(dirname(destPath));
      await Bun.write(destPath, Bun.file(srcPath));
    }
  }
};

const calculateDirectorySize = async (root: string, current: string, ignore: (rel: string) => boolean) => {
  let total = 0;
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(current, entry.name);
    const relPath = toPosix(relative(root, entryPath));
    if (ignore(relPath)) continue;
    if (entry.isDirectory()) {
      total += await calculateDirectorySize(root, entryPath, ignore);
      continue;
    }
    if (entry.isFile()) {
      const stats = await lstat(entryPath);
      total += stats.size;
    }
  }
  return total;
};

const persistState = async (store: SandboxStore) => {
  await ensureDir(dirname(store.statePath));
  await writeFile(store.statePath, JSON.stringify(store.state, null, 2) + "\n", "utf8");
};

export const loadSandboxStore = async (baseWorkspace: WorkspaceInfo, target: TargetInfo): Promise<SandboxStore> => {
  const root = await ensureSandboxRoot(baseWorkspace.path);
  const statePath = sandboxStatePath(root);
  const existing = (await exists(statePath)) ? await readFile(statePath, "utf8").then((raw) => JSON.parse(raw) as SandboxState).catch(() => null) : null;
  const state: SandboxState = existing && existing.version === SANDBOX_STATE_VERSION
    ? existing
    : {
        version: SANDBOX_STATE_VERSION,
        activeId: baseWorkspace.id,
        sandboxes: [],
      };
  ensureBaseSandbox(state, baseWorkspace, target);
  if (!state.activeId) state.activeId = baseWorkspace.id;
  const store = { baseWorkspace, target, root, statePath, state };
  await persistState(store);
  return store;
};

export const listSandboxes = (store: SandboxStore) => {
  const activeId = store.state.activeId;
  return store.state.sandboxes.map((sandbox) => ({
    ...sandbox,
    status: deriveSandboxStatus(sandbox, activeId),
  }));
};

export const getSandbox = (store: SandboxStore, id: string) =>
  store.state.sandboxes.find((sandbox) => sandbox.id === id) ?? null;

export const setActiveSandbox = async (store: SandboxStore, id: string) => {
  const sandbox = getSandbox(store, id);
  if (!sandbox) throw new Error("Sandbox not found");
  if (sandbox.status === "archived") throw new Error("Sandbox is archived");
  store.state.activeId = sandbox.id;
  sandbox.updatedAt = nowMs();
  await persistState(store);
  return sandbox;
};

export const archiveSandbox = async (store: SandboxStore, id: string) => {
  const sandbox = getSandbox(store, id);
  if (!sandbox) throw new Error("Sandbox not found");
  if (sandbox.id === store.baseWorkspace.id) {
    throw new Error("Base sandbox cannot be archived");
  }
  sandbox.status = "archived";
  sandbox.updatedAt = nowMs();
  await persistState(store);
  return sandbox;
};

export const deleteSandbox = async (store: SandboxStore, id: string) => {
  const sandbox = getSandbox(store, id);
  if (!sandbox) throw new Error("Sandbox not found");
  if (sandbox.id === store.baseWorkspace.id) {
    throw new Error("Base sandbox cannot be deleted");
  }
  if (sandbox.path && sandbox.path.startsWith(store.root)) {
    if (existsSync(sandbox.path)) {
      await rm(sandbox.path, { recursive: true, force: true });
    }
  }
  store.state.sandboxes = store.state.sandboxes.filter((entry) => entry.id !== sandbox.id);
  if (store.state.activeId === sandbox.id) {
    store.state.activeId = store.baseWorkspace.id;
  }
  await persistState(store);
  return sandbox;
};

export const createSandbox = async (store: SandboxStore, options: SandboxCreateOptions) => {
  const nameInput = options.name?.trim();
  const name = nameInput && nameInput.length ? nameInput : `${DEFAULT_SANDBOX_NAME} ${store.state.sandboxes.length + 1}`;
  const id = `sbx_${shortId()}`;
  const targetPath = join(store.root, id);
  const sourceType = options.source.type;
  const sourceSandbox =
    sourceType === "sandbox" && options.source.id
      ? getSandbox(store, options.source.id)
      : null;
  const sourcePath = sourceSandbox?.path ?? store.baseWorkspace.path;
  const ignore = await buildIgnoreMatcher(sourcePath);

  if (sourceType === "sandbox") {
    await copyWorkspace(sourcePath, sourcePath, targetPath, ignore);
  } else {
    const gitRoot = await resolveGitRoot(sourcePath);
    const isRoot = gitRoot && resolve(gitRoot) === resolve(sourcePath);
    if (gitRoot && isRoot && (await isGitClean(sourcePath))) {
      const ok = await attemptWorktree(sourcePath, targetPath);
      if (!ok) {
        const cloneOk = await attemptClone(sourcePath, targetPath);
        if (!cloneOk) {
          await copyWorkspace(sourcePath, sourcePath, targetPath, ignore);
        }
      }
    } else if (gitRoot && isRoot) {
      const cloneOk = await attemptClone(sourcePath, targetPath);
      if (!cloneOk) {
        await copyWorkspace(sourcePath, sourcePath, targetPath, ignore);
      }
    } else {
      await copyWorkspace(sourcePath, sourcePath, targetPath, ignore);
    }
  }

  const createdAt = nowMs();
  const record: SandboxInfo = {
    id,
    name,
    targetId: store.target.id,
    baseWorkspaceId: store.baseWorkspace.id,
    path: targetPath,
    createdAt,
    updatedAt: createdAt,
    status: "active",
  };
  store.state.sandboxes.push(record);
  store.state.activeId = record.id;
  await persistState(store);
  return record;
};

export const readSandboxSize = async (store: SandboxStore, sandbox: SandboxInfo) => {
  const ignore = await buildIgnoreMatcher(sandbox.path);
  return calculateDirectorySize(sandbox.path, sandbox.path, ignore);
};

export const syncSandboxStatuses = (store: SandboxStore) => {
  const activeId = store.state.activeId;
  store.state.sandboxes = store.state.sandboxes.map((sandbox) => ({
    ...sandbox,
    status: deriveSandboxStatus(sandbox, activeId),
  }));
};

export const ensureSandboxRootsAuthorized = (roots: string[], sandboxPaths: string[]) => {
  const next = new Set(roots.map((root) => resolve(root)));
  for (const path of sandboxPaths) {
    next.add(resolve(path));
  }
  return Array.from(next);
};

export const resolveSandboxByPath = (store: SandboxStore, path: string) => {
  const normalized = resolve(path);
  return store.state.sandboxes.find((sandbox) => resolve(sandbox.path) === normalized) ?? null;
};

export const isSandboxPath = (store: SandboxStore, path: string) => {
  const resolved = resolve(path);
  return resolved === resolve(store.root) || resolved.startsWith(resolve(store.root) + sep);
};
