#!/usr/bin/env bun

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

type SandboxMode = "none" | "auto" | "docker" | "container";
type ApprovalMode = "manual" | "auto";

type Entrypoint = {
  path: string;
  rw: boolean;
};

type Instance = {
  id: string;
  name: string;
  avatarSeed: string;
  createdAt: number;
  dir: string;
  workspaceDir: string;
  entrypoints: Entrypoint[];
  openwork: {
    host: string;
    port: number;
    url: string;
    token: string;
    hostToken: string;
    approval: ApprovalMode;
  };
  openwrk?: {
    sandbox: SandboxMode;
    stopCommand?: string;
    startedAt?: number;
  };
};

type ConnectArtifact = {
  kind: "openwork.connect.v1";
  hostUrl: string;
  workspaceId: string;
  workspaceUrl: string;
  token: string;
  tokenScope: "collaborator";
  createdAt: number;
};

function usage(): string {
  return [
    "openwork-agent-lab",
    "",
    "Commands:",
    "  create   Create a new Agent Lab instance",
    "  list     List existing instances",
    "  start    Start an instance (spawns openwrk)",
    "  stop     Stop an instance (stops sandbox container)",
    "  status   Show instance status (health + workspace id)",
    "  open     Print Toy UI URL for an instance",
    "  delete   Delete an instance directory (danger)",
    "",
    "Options:",
    "  --dir <path>         Base directory (default: ~/.openwork/agent-lab)",
    "  --name <name>        Agent name (create)",
    "  --id <id>            Instance id (create)",
    "  --port <port>        OpenWork server port (create/start)",
    "  --approval <mode>    manual|auto (default: manual)",
    "  --sandbox <mode>     none|auto|docker|container (default: auto)",
    "  --start              Start immediately after create",
    "  --help               Show help",
  ].join("\n");
}

function readFlag(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  if (idx === -1) return undefined;
  const next = argv[idx + 1];
  if (!next || next.startsWith("--")) return undefined;
  return next;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function readNumberFlag(argv: string[], name: string): number | undefined {
  const raw = readFlag(argv, name);
  if (!raw) return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num)) return undefined;
  return Math.trunc(num);
}

function normalizeApproval(raw: string | undefined): ApprovalMode {
  if (raw === "auto") return "auto";
  return "manual";
}

function normalizeSandbox(raw: string | undefined): SandboxMode {
  if (raw === "none" || raw === "auto" || raw === "docker" || raw === "container") return raw;
  return "auto";
}

function baseDirFromArgs(argv: string[]): string {
  const override = readFlag(argv, "--dir") ?? process.env.OPENWORK_AGENT_LAB_DIR;
  return resolve(override?.trim() ? override.trim() : join(homedir(), ".openwork", "agent-lab"));
}

function instanceDir(baseDir: string, id: string): string {
  return join(baseDir, "instances", id);
}

function agentPath(dir: string): string {
  return join(dir, "agent.json");
}

async function loadInstance(dir: string): Promise<Instance> {
  const raw = await readFile(agentPath(dir), "utf8");
  return JSON.parse(raw) as Instance;
}

async function saveInstance(dir: string, instance: Instance): Promise<void> {
  await writeFile(agentPath(dir), JSON.stringify(instance, null, 2));
}

function randomToken(): string {
  // URL-safe enough for a toy: UUID without dashes.
  return randomUUID().replaceAll("-", "");
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function writeIfMissing(path: string, content: string): Promise<void> {
  if (existsSync(path)) return;
  await ensureDir(dirname(path));
  await writeFile(path, content);
}

function defaultPersonality(name: string): string {
  return [
    "# Personality",
    "",
    `You are ${name}, a calm and serious AI co-worker.`,
    "",
    "- Tone: professional, direct, not overly friendly.",
    "- Be transparent about what you are doing.",
    "- Prefer short checkpoints over long monologues.",
    "",
    "When unsure, ask one clarifying question.",
    "",
  ].join("\n");
}

function defaultBehavior(): string {
  return [
    "# Behavior",
    "",
    "Conversation-first configuration:",
    "- The user configures you by talking to you.",
    "- After completing a task, if the user says 'turn this into a skill', create a new skill in .opencode/skills/<name>/SKILL.md.",
    "",
    "Checkpoints and progress:",
    "- Respond quickly with an acknowledgement and what you will do next.",
    "- For long tasks, do a quick preflight step first, then the heavy step.",
    "- If something will take minutes, say so before you start.",
    "",
  ].join("\n");
}

async function provisionWorkspace(workspaceDir: string, name: string): Promise<void> {
  await ensureDir(workspaceDir);
  await ensureDir(join(workspaceDir, ".opencode"));
  await ensureDir(join(workspaceDir, ".opencode", "agent"));
  await ensureDir(join(workspaceDir, ".opencode", "skills"));
  await ensureDir(join(workspaceDir, ".opencode", "commands"));
  await ensureDir(join(workspaceDir, ".opencode", "openwork", "inbox"));
  await ensureDir(join(workspaceDir, ".opencode", "openwork", "outbox"));

  await writeIfMissing(join(workspaceDir, ".opencode", "agent", "personality.md"), defaultPersonality(name));
  await writeIfMissing(join(workspaceDir, ".opencode", "agent", "behavior.md"), defaultBehavior());

  const configPath = join(workspaceDir, "opencode.json");
  if (!existsSync(configPath)) {
    const opencodeConfig = {
      $schema: "https://opencode.ai/config.json",
      instructions: [
        ".opencode/agent/personality.md",
        ".opencode/agent/behavior.md",
      ],
      // Sandbox provides the primary filesystem safety boundary.
      permission: {
        external_directory: "deny",
      },
    };
    await writeFile(configPath, JSON.stringify(opencodeConfig, null, 2));
  }
}

async function listInstanceDirs(baseDir: string): Promise<string[]> {
  const root = join(baseDir, "instances");
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => join(root, e.name));
  } catch {
    return [];
  }
}

async function fetchJson(url: string, options?: { token?: string }): Promise<any> {
  const headers: Record<string, string> = {};
  if (options?.token) headers.Authorization = `Bearer ${options.token}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(4000) });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg = json && json.message ? json.message : (text || res.statusText);
    throw new Error(`http_${res.status}: ${msg}`);
  }
  return json;
}

async function waitForOpenwork(url: string, timeoutMs = 12_000): Promise<void> {
  const start = Date.now();
  let last = "waiting";
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return;
      last = `status_${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`openwork_server_unhealthy: ${last}`);
}

function openwrkBin(): string {
  const override = (process.env.OPENWORK_AGENT_LAB_OPENWRK_BIN ?? "").trim();
  if (override) return override;
  return "openwrk";
}

async function runOpenwrkStart(options: {
  workspaceDir: string;
  dataDir: string;
  sidecarDir: string;
  sandboxPersistDir: string;
  sandbox: SandboxMode;
  openworkHost: string;
  openworkPort: number;
  token: string;
  hostToken: string;
  approval: ApprovalMode;
  runId: string;
}): Promise<{ stopCommand?: string }>{
  const args = [
    "start",
    "--no-tui",
    "--detach",
    "--run-id",
    options.runId,
    "--sandbox",
    options.sandbox,
    "--workspace",
    options.workspaceDir,
    "--data-dir",
    options.dataDir,
    "--sidecar-dir",
    options.sidecarDir,
    "--sandbox-persist-dir",
    options.sandboxPersistDir,
    "--openwork-host",
    options.openworkHost,
    "--openwork-port",
    String(options.openworkPort),
    "--openwork-token",
    options.token,
    "--openwork-host-token",
    options.hostToken,
    "--approval",
    options.approval,
    "--no-owpenbot",
  ];

  return await new Promise((resolveResult, reject) => {
    const child = spawn(openwrkBin(), args, {
      cwd: options.workspaceDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, OPENWRK_COLOR: "0" },
    });
    let out = "";
    let err = "";
    child.stdout?.on("data", (chunk) => {
      out += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      err += String(chunk);
    });
    child.on("error", (error) => reject(error));
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`openwrk_failed_${code}: ${err || out}`));
        return;
      }
      const stopLine = out
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.startsWith("Stop:"));
      const stopCommand = stopLine ? stopLine.replace(/^Stop:\s*/, "").trim() : undefined;
      resolveResult({ stopCommand });
    });
  });
}

async function create(argv: string[]) {
  const baseDir = baseDirFromArgs(argv);
  const name = readFlag(argv, "--name") ?? "Scout";
  const id = (readFlag(argv, "--id") ?? "").trim() || `agent_${randomUUID().slice(0, 8)}`;
  const port = readNumberFlag(argv, "--port") ?? 8787;
  const approval = normalizeApproval(readFlag(argv, "--approval"));
  const sandbox = normalizeSandbox(readFlag(argv, "--sandbox"));

  const dir = instanceDir(baseDir, id);
  const workspaceDir = join(dir, "workspace");
  await ensureDir(join(baseDir, "instances"));
  await ensureDir(dir);

  await provisionWorkspace(workspaceDir, name);

  const token = randomToken();
  const hostToken = randomToken();
  const instance: Instance = {
    id,
    name,
    avatarSeed: `${id}:${name}`,
    createdAt: Date.now(),
    dir,
    workspaceDir,
    entrypoints: [],
    openwork: {
      host: "127.0.0.1",
      port,
      url: `http://127.0.0.1:${port}`,
      token,
      hostToken,
      approval,
    },
    openwrk: {
      sandbox,
    },
  };
  await saveInstance(dir, instance);

  console.log(JSON.stringify({ ok: true, instance }, null, 2));

  if (hasFlag(argv, "--start")) {
    await start([id, ...argv.filter((x) => x !== "--start")]);
  }
}

async function list(argv: string[]) {
  const baseDir = baseDirFromArgs(argv);
  const dirs = await listInstanceDirs(baseDir);
  const items: Instance[] = [];
  for (const dir of dirs) {
    const path = agentPath(dir);
    if (!existsSync(path)) continue;
    try {
      items.push(await loadInstance(dir));
    } catch {
      // ignore broken entries
    }
  }
  console.log(JSON.stringify({ ok: true, items }, null, 2));
}

async function start(argv: string[]) {
  const baseDir = baseDirFromArgs(argv);
  const id = argv[0];
  if (!id) throw new Error("missing_instance_id");
  const dir = instanceDir(baseDir, id);
  const instance = await loadInstance(dir);

  const port = readNumberFlag(argv, "--port") ?? instance.openwork.port;
  const approval = normalizeApproval(readFlag(argv, "--approval")) ?? instance.openwork.approval;
  const sandbox = normalizeSandbox(readFlag(argv, "--sandbox")) ?? (instance.openwrk?.sandbox ?? "auto");

  instance.openwork.port = port;
  instance.openwork.url = `http://${instance.openwork.host}:${port}`;
  instance.openwork.approval = approval;
  if (!instance.openwrk) instance.openwrk = { sandbox };
  instance.openwrk.sandbox = sandbox;

  const dataDir = join(instance.dir, "openwrk-data");
  const sidecarDir = join(instance.dir, "sidecars");
  const sandboxPersistDir = join(instance.dir, "sandbox-persist");
  await ensureDir(dataDir);
  await ensureDir(sidecarDir);
  await ensureDir(sandboxPersistDir);

  const result = await runOpenwrkStart({
    workspaceDir: instance.workspaceDir,
    dataDir,
    sidecarDir,
    sandboxPersistDir,
    sandbox,
    openworkHost: instance.openwork.host,
    openworkPort: instance.openwork.port,
    token: instance.openwork.token,
    hostToken: instance.openwork.hostToken,
    approval: instance.openwork.approval,
    runId: instance.id,
  });

  instance.openwrk.stopCommand = result.stopCommand;
  instance.openwrk.startedAt = Date.now();
  await saveInstance(dir, instance);

  await waitForOpenwork(instance.openwork.url);

  const workspaces = await fetchJson(`${instance.openwork.url.replace(/\/$/, "")}/workspaces`, { token: instance.openwork.token });
  const workspaceId = String(workspaces?.activeId || (workspaces?.items?.[0]?.id ?? ""));
  if (!workspaceId) throw new Error("workspace_id_missing");
  const connect: ConnectArtifact = {
    kind: "openwork.connect.v1",
    hostUrl: instance.openwork.url,
    workspaceId,
    workspaceUrl: `${instance.openwork.url.replace(/\/$/, "")}/w/${encodeURIComponent(workspaceId)}`,
    token: instance.openwork.token,
    tokenScope: "collaborator",
    createdAt: Date.now(),
  };

  console.log(JSON.stringify({ ok: true, connect, ui: `${instance.openwork.url}/ui#token=${instance.openwork.token}` }, null, 2));
}

async function stop(argv: string[]) {
  const baseDir = baseDirFromArgs(argv);
  const id = argv[0];
  if (!id) throw new Error("missing_instance_id");
  const dir = instanceDir(baseDir, id);
  const instance = await loadInstance(dir);
  const stopCommand = instance.openwrk?.stopCommand;
  if (!stopCommand) {
    throw new Error("missing_stop_command");
  }

  const parts = stopCommand.split(" ").filter(Boolean);
  const cmd = parts[0];
  const args = parts.slice(1);
  await new Promise<void>((resolveResult, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", (err) => reject(err));
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`stop_failed_${code}`));
        return;
      }
      resolveResult();
    });
  });

  console.log(JSON.stringify({ ok: true }, null, 2));
}

async function status(argv: string[]) {
  const baseDir = baseDirFromArgs(argv);
  const id = argv[0];
  if (!id) throw new Error("missing_instance_id");
  const dir = instanceDir(baseDir, id);
  const instance = await loadInstance(dir);
  const url = instance.openwork.url.replace(/\/$/, "");
  const health = await fetchJson(`${url}/health`).catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  let workspaceId: string | null = null;
  try {
    const workspaces = await fetchJson(`${url}/workspaces`, { token: instance.openwork.token });
    workspaceId = String(workspaces?.activeId || (workspaces?.items?.[0]?.id ?? "")) || null;
  } catch {
    workspaceId = null;
  }
  console.log(JSON.stringify({ ok: true, instance: { id: instance.id, name: instance.name }, openwork: { url, health }, workspaceId }, null, 2));
}

async function open(argv: string[]) {
  const baseDir = baseDirFromArgs(argv);
  const id = argv[0];
  if (!id) throw new Error("missing_instance_id");
  const dir = instanceDir(baseDir, id);
  const instance = await loadInstance(dir);
  const url = `${instance.openwork.url.replace(/\/$/, "")}/ui#token=${instance.openwork.token}`;
  console.log(url);
}

async function del(argv: string[]) {
  const baseDir = baseDirFromArgs(argv);
  const id = argv[0];
  if (!id) throw new Error("missing_instance_id");
  const dir = instanceDir(baseDir, id);
  if (!dir.startsWith(resolve(baseDir))) {
    throw new Error("unsafe_delete");
  }
  await rm(dir, { recursive: true, force: true });
  console.log(JSON.stringify({ ok: true }, null, 2));
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || hasFlag(argv, "--help") || hasFlag(argv, "-h")) {
    console.log(usage());
    return;
  }
  const [cmd, ...rest] = argv;
  try {
    if (cmd === "create") return await create(rest);
    if (cmd === "list") return await list(rest);
    if (cmd === "start") return await start(rest);
    if (cmd === "stop") return await stop(rest);
    if (cmd === "status") return await status(rest);
    if (cmd === "open") return await open(rest);
    if (cmd === "delete") return await del(rest);
    throw new Error(`unknown_command: ${cmd}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(msg);
    process.exit(1);
  }
}

await main();
