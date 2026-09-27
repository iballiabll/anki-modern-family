/**
 * 账号数据备份：把 DATA_DIR 里的文件快照成备份仓库里的一次 GitHub 提交。
 *
 * 环境变量：
 *   GITHUB_BACKUP_TOKEN  必填；对备份仓库有 contents:write 权限的 fine-grained token
 *   BACKUP_REPO          备份仓库，默认 iballiabll/iball-cabin-backup
 *   BACKUP_BRANCH        备份分支，默认 main
 *   DATA_DIR             备份源目录，默认 <repo>/work/data
 *
 * 安全约束：
 *   · 目标仓库必须是私有仓库；查不到可见性或确认为公开时直接失败，不上传。
 *   · 状态文件只记时间、文件数、字节数和 commit，不记任何数据正文。
 *   · 快照按时间戳放一个目录，不覆盖历史快照；同一个快照目录重复备份会生成新提交。
 *
 * 用法：
 *   node scripts/backup-data.mjs            立即备份一次
 *   node scripts/backup-data.mjs --status   只打印当前备份状态
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API_ROOT = "https://api.github.com";
const STATUS_FILE = "backup-status.json";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_FILE_BYTES = 40 * 1024 * 1024;
const EXCLUDED_NAMES = new Set([STATUS_FILE, ".DS_Store", "Thumbs.db"]);
const EXCLUDED_SUFFIXES = [".tmp", ".temp", ".swp", ".part", ".lock"];

function envValue(name, fallback = "") {
  const value = String(process.env[name] || "").trim();
  return value || fallback;
}

export function backupConfig() {
  const dataDir = envValue("DATA_DIR")
    ? path.resolve(envValue("DATA_DIR"))
    : path.join(repoRoot, "work", "data");
  return {
    token: envValue("GITHUB_BACKUP_TOKEN"),
    repo: envValue("BACKUP_REPO", "iballiabll/iball-cabin-backup"),
    branch: envValue("BACKUP_BRANCH", "main"),
    dataDir,
    statusPath: path.join(dataDir, STATUS_FILE),
    configured: Boolean(envValue("GITHUB_BACKUP_TOKEN")),
  };
}

/** 状态文件只保留元数据，读的时候顺手丢掉任何多余字段。 */
function cleanStatus(raw, config = backupConfig()) {
  const source = raw && typeof raw === "object" ? raw : {};
  const number = (value) => Math.max(0, Number(value) || 0);
  return {
    version: 1,
    lastStatus: source.lastStatus === "ok" ? "ok" : source.lastStatus === "error" ? "error" : "never",
    lastRunAt: String(source.lastRunAt || ""),
    startedAt: String(source.startedAt || ""),
    durationMs: number(source.durationMs),
    trigger: String(source.trigger || ""),
    repo: String(source.repo || config.repo),
    branch: String(source.branch || config.branch),
    snapshot: String(source.snapshot || ""),
    fileCount: number(source.fileCount),
    bytes: number(source.bytes),
    commitSha: String(source.commitSha || ""),
    commitUrl: String(source.commitUrl || ""),
    message: String(source.message || "").slice(0, 500),
  };
}

export async function readBackupStatus() {
  const config = backupConfig();
  let status = cleanStatus(null, config);
  try {
    const text = await fs.readFile(config.statusPath, "utf8");
    status = cleanStatus(JSON.parse(text), config);
  } catch {
    // 还没有备份过，或状态文件损坏；都按“从未备份”对外展示。
  }
  return {
    configured: config.configured,
    repo: config.repo,
    branch: config.branch,
    status,
  };
}

async function writeStatus(status) {
  const config = backupConfig();
  await fs.mkdir(config.dataDir, { recursive: true });
  const tempPath = `${config.statusPath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, config.statusPath);
}

class BackupError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.name = "BackupError";
    this.statusCode = statusCode;
  }
}

async function githubRequest(config, url, { method = "GET", body } = {}) {
  if (!config.token) {
    throw new BackupError("没有配置 GITHUB_BACKUP_TOKEN，无法备份。", 503);
  }
  const response = await fetch(url.startsWith("http") ? url : `${API_ROOT}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "iball-cabin-backup",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const detail = data && data.message ? data.message : `HTTP ${response.status}`;
    // 保留 4xx，让调用方能区分“空仓库 / 不存在 / 无权限”等可预期状态。
    const statusCode = response.status >= 400 && response.status < 500 ? response.status : 502;
    throw new BackupError(`GitHub API ${method} ${url} 失败：${detail}`, statusCode);
  }
  return data;
}

/** 目标仓库必须存在且为私有，否则 fail closed。 */
async function assertPrivateRepo(config) {
  const repo = await githubRequest(config, `/repos/${config.repo}`);
  if (!repo || repo.private !== true) {
    throw new BackupError(
      `备份仓库 ${config.repo} 不是私有仓库，已停止上传。请把它设为 Private 后重试。`,
      409,
    );
  }
  if (repo.archived) {
    throw new BackupError(`备份仓库 ${config.repo} 已归档，无法写入。`, 409);
  }
  if (repo.full_name && repo.full_name.toLowerCase() !== config.repo.toLowerCase()) {
    throw new BackupError(`GitHub 返回的仓库是 ${repo.full_name}，和配置的 ${config.repo} 不一致。`, 409);
  }
  return repo;
}

function shouldSkip(name) {
  if (EXCLUDED_NAMES.has(name)) return true;
  const lower = name.toLowerCase();
  return EXCLUDED_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

/** 递归收集 DATA_DIR 下的普通文件，返回相对路径和内容。 */
async function collectFiles(dir) {
  const files = [];
  let totalBytes = 0;

  async function walk(current, relative = "") {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (shouldSkip(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(absolute, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await fs.stat(absolute);
      if (stat.size > MAX_FILE_BYTES) {
        throw new BackupError(`文件 ${rel} 超过 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB，已停止备份。`, 413);
      }
      totalBytes += stat.size;
      files.push({ path: rel, buffer: await fs.readFile(absolute), size: stat.size });
    }
  }

  await walk(dir);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return { files, totalBytes };
}

function snapshotStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "-",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
    "Z",
  ].join("");
}

async function resolveHead(config) {
  try {
    const ref = await githubRequest(config, `/repos/${config.repo}/git/ref/heads/${encodeURIComponent(config.branch)}`);
    const commitSha = ref && ref.object && ref.object.sha;
    if (!commitSha) return null;
    const commit = await githubRequest(config, `/repos/${config.repo}/git/commits/${commitSha}`);
    return { commitSha, treeSha: commit && commit.tree ? commit.tree.sha : "" };
  } catch (error) {
    if (error.statusCode === 404) return null;
    // 空仓库还没有任何提交，GitHub 对读取 HEAD 会返回 409 Git Repository is empty。
    if (error.statusCode === 409 && /empty/i.test(error.message)) return null;
    throw error;
  }
}

/** 把一批文件写成 blob，再组成一个基于当前 HEAD 的新 tree。 */
async function uploadSnapshot(config, files, { snapshot, baseTreeSha }) {
  const tree = [];
  for (const file of files) {
    const blob = await githubRequest(config, `/repos/${config.repo}/git/blobs`, {
      method: "POST",
      body: { content: file.buffer.toString("base64"), encoding: "base64" },
    });
    tree.push({ path: `${snapshot}/${file.path}`, mode: "100644", type: "blob", sha: blob.sha });
  }
  const created = await githubRequest(config, `/repos/${config.repo}/git/trees`, {
    method: "POST",
    body: baseTreeSha ? { base_tree: baseTreeSha, tree } : { tree },
  });
  return created.sha;
}

async function commitSnapshot(config, { treeSha, parentSha, message }) {
  const commit = await githubRequest(config, `/repos/${config.repo}/git/commits`, {
    method: "POST",
    body: {
      message,
      tree: treeSha,
      parents: parentSha ? [parentSha] : [],
    },
  });
  if (parentSha) {
    await githubRequest(config, `/repos/${config.repo}/git/refs/heads/${encodeURIComponent(config.branch)}`, {
      method: "PATCH",
      body: { sha: commit.sha, force: false },
    });
  } else {
    await githubRequest(config, `/repos/${config.repo}/git/refs`, {
      method: "POST",
      body: { ref: `refs/heads/${config.branch}`, sha: commit.sha },
    });
  }
  return commit.sha;
}

/**
 * 执行一次备份。预期失败不会抛出，而是写一条 error 状态并返回结果，
 * 方便管理端直接把失败原因显示给管理员。
 */
export async function runBackup({ trigger = "manual" } = {}) {
  const config = backupConfig();
  const started = new Date();
  const baseStatus = {
    version: 1,
    lastStatus: "error",
    lastRunAt: "",
    startedAt: started.toISOString(),
    durationMs: 0,
    trigger,
    repo: config.repo,
    branch: config.branch,
    snapshot: "",
    fileCount: 0,
    bytes: 0,
    commitSha: "",
    commitUrl: "",
    message: "",
  };

  try {
    if (!config.configured) {
      throw new BackupError("没有配置 GITHUB_BACKUP_TOKEN，无法备份。", 503);
    }
    await assertPrivateRepo(config);
    const { files, totalBytes } = await collectFiles(config.dataDir);
    if (!files.length) {
      throw new BackupError(`数据目录 ${config.dataDir} 里没有可备份的文件。`, 409);
    }

    const snapshot = `snapshots/${snapshotStamp(started)}`;
    const head = await resolveHead(config);
    const treeSha = await uploadSnapshot(config, files, {
      snapshot,
      baseTreeSha: head ? head.treeSha : "",
    });
    const message = `Backup ${snapshot} (${files.length} files, ${totalBytes} bytes)`;
    const commitSha = await commitSnapshot(config, {
      treeSha,
      parentSha: head ? head.commitSha : "",
      message,
    });

    const status = {
      ...baseStatus,
      lastStatus: "ok",
      // lastRunAt 记完成时刻；startedAt 保留开始时刻，方便排查耗时。
      lastRunAt: new Date().toISOString(),
      durationMs: Date.now() - started.getTime(),
      snapshot,
      fileCount: files.length,
      bytes: totalBytes,
      commitSha,
      commitUrl: `https://github.com/${config.repo}/commit/${commitSha}`,
      message: `已备份 ${files.length} 个文件到 ${snapshot}`,
    };
    await writeStatus(status);
    return { ok: true, ...status };
  } catch (error) {
    const status = {
      ...baseStatus,
      lastRunAt: new Date().toISOString(),
      durationMs: Date.now() - started.getTime(),
      message: error instanceof Error ? error.message : "备份失败。",
    };
    await writeStatus(status).catch(() => {});
    return { ok: false, ...status };
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--status")) {
    const status = await readBackupStatus();
    console.log(JSON.stringify(status, null, 2));
    process.exitCode = status.status.lastStatus === "error" ? 1 : 0;
    return;
  }
  const trigger = args.includes("--cli") ? "cli" : "manual";
  const result = await runBackup({ trigger });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
