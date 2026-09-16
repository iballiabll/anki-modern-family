#!/usr/bin/env node
// Pushes the current HEAD commit through the GitHub Git Data API.
// Useful where the git receive-pack endpoint is blocked but api.github.com works.

import { execFileSync } from "node:child_process";

const API_ROOT = "https://api.github.com";
const API_VERSION = "2022-11-28";

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function gitTrim(...args) {
  return git(...args).trim();
}

async function github(path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "codex-api-push",
      "x-github-api-version": API_VERSION,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const detail =
      typeof payload === "string" ? payload : JSON.stringify(payload);
    throw new Error(
      `${method} ${path} -> ${response.status} ${detail.slice(0, 900)}`,
    );
  }

  return payload;
}

function parseBlobTree(raw) {
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+) blob ([0-9a-f]+)\t(.*)$/);
      if (!match) {
        fail(`Cannot parse git ls-tree line: ${line}`);
      }
      return { mode: match[1], sha: match[2], path: match[3] };
    });
}

function repoFromRemote(remote) {
  const value = String(remote || "").trim();
  const patterns = [
    /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/,
    /^ssh:\/\/git@github\.com\/?([^/]+)\/(.+?)(?:\.git)?$/,
    /^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/,
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) {
      return `${match[1]}/${match[2]}`;
    }
  }

  fail(`Cannot parse GitHub remote: ${value}`);
}

function localHead() {
  return {
    commit: gitTrim("rev-parse", "HEAD"),
    parent: gitTrim("rev-parse", "HEAD^"),
    subject: gitTrim("log", "-1", "--pretty=%s"),
    body: gitTrim("log", "-1", "--pretty=%b"),
  };
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    fail("GITHUB_TOKEN is not set.");
  }

  const repo = repoFromRemote(gitTrim("remote", "get-url", "origin"));
  const head = localHead();
  const localBlobs = parseBlobTree(gitTrim("ls-tree", "-r", "--full-tree", head.commit));
  const remoteBlobs = parseBlobTree(gitTrim("ls-tree", "-r", "--full-tree", head.parent));

  const remoteRef = await github(`/repos/${repo}/git/ref/heads/main`, { token });
  const remoteHead = remoteRef?.object?.sha;

  if (remoteHead === head.commit) {
    console.log(`Already up to date: ${head.commit.slice(0, 7)}`);
    return;
  }

  if (remoteHead !== head.parent) {
    fail(
      `Remote main is at ${remoteHead?.slice(0, 7)} but local parent is ` +
        `${head.parent.slice(0, 7)}; refusing to overwrite unrelated history.`,
    );
  }

  const previousByPath = new Map(
    remoteBlobs.map((entry) => [entry.path, entry]),
  );
  const currentByPath = new Map(localBlobs.map((entry) => [entry.path, entry]));
  const changed = localBlobs.filter((entry) => {
    const previous = previousByPath.get(entry.path);
    return !previous || previous.sha !== entry.sha || previous.mode !== entry.mode;
  });
  const deleted = remoteBlobs.filter((entry) => !currentByPath.has(entry.path));

  const remoteCommit = await github(
    `/repos/${repo}/git/commits/${encodeURIComponent(remoteHead)}`,
    { token },
  );

  const treeEntries = [];
  for (const entry of changed) {
    const blob = await github(`/repos/${repo}/git/blobs`, {
      method: "POST",
      token,
      body: {
        content: git("show", `${head.commit}:${entry.path}`),
        encoding: "utf-8",
      },
    });
    treeEntries.push({
      path: entry.path,
      mode: entry.mode,
      type: "blob",
      sha: blob.sha,
    });
  }

  deleted.forEach((entry) => {
    treeEntries.push({
      path: entry.path,
      mode: entry.mode,
      type: "blob",
      sha: null,
    });
  });

  const tree = await github(`/repos/${repo}/git/trees`, {
    method: "POST",
    token,
    body: { base_tree: remoteCommit?.tree?.sha, tree: treeEntries },
  });

  const commit = await github(`/repos/${repo}/git/commits`, {
    method: "POST",
    token,
    body: {
      message: [head.subject, head.body].filter(Boolean).join("\n\n"),
      tree: tree.sha,
      parents: [head.parent],
    },
  });

  await github(`/repos/${repo}/git/refs/heads/main`, {
    method: "PATCH",
    token,
    body: { sha: commit.sha, force: false },
  });

  console.log(
    `Pushed ${head.commit.slice(0, 7)} -> ${commit.sha.slice(0, 7)} ` +
      `(${changed.length} changed, ${deleted.length} deleted)`,
  );
  console.log(`https://github.com/${repo}/commit/${commit.sha}`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
