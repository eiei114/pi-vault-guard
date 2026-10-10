import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { syncBuiltinESMExports } from "node:module";
import {
  classifyDirtyPath,
  parseAheadBehind,
  parsePorcelainBranch,
  parsePorcelainStatus,
  buildVaultGuardStatus,
} from "../lib/status.ts";
import { formatStatusJson, formatStatusText } from "../lib/render-status.ts";
import { buildVaultGuardBegin, readVaultGuardLock, lockPath } from "../lib/lock.ts";

test("parses porcelain paths and classifies risky files", () => {
  const paths = parsePorcelainStatus(" M notes.md\n?? .pi/settings.json\n?? exports/report.pdf\n");
  assert.deepEqual(paths.map(({ path, kind }) => ({ path, kind })), [
    { path: "notes.md", kind: "tracked" },
    { path: ".pi/settings.json", kind: "untracked" },
    { path: "exports/report.pdf", kind: "untracked" },
  ]);
  assert.equal(classifyDirtyPath(".pi/settings.json", " M"), "pi-settings");
});

test("parses ahead and behind counts", () => {
  assert.deepEqual(parseAheadBehind("3\t2"), { ahead: 3, behind: 2 });
  assert.deepEqual(parseAheadBehind(null), { ahead: 0, behind: 0 });
});

test("parses branch metadata from porcelain status headers", () => {
  assert.deepEqual(parsePorcelainBranch("## main...origin/main [ahead 3, behind 2]\n M notes.md\n"), {
    branch: "main",
    upstream: "origin/main",
    ahead: 3,
    behind: 2,
  });
  assert.deepEqual(parsePorcelainBranch("## HEAD (no branch)\n"), {
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
  });
  assert.deepEqual(parsePorcelainBranch("## No commits yet on main\n"), {
    branch: "main",
    upstream: null,
    ahead: 0,
    behind: 0,
  });
  assert.deepEqual(parsePorcelainBranch("## main...origin/main [gone]\n"), {
    branch: "main",
    upstream: null,
    ahead: 0,
    behind: 0,
  });
});

test("non-git directories return a controlled warning", () => {
  const status = buildVaultGuardStatus("/path/that/does/not/exist");
  assert.equal(status.isGitRepository, false);
  assert.equal(status.severity, "warn");
  assert.match(status.message, /not a git repository/);
  assert.match(formatStatusText(status), /branch: \(not a git repository\)/);
});

test("reports all unpushed commits while previewing only the five newest", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-guard-unpushed-"));
  const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-guard-remote-"));
  const git = (root, args) => execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
  git(remoteDir, ["init", "--bare", "-q"]);
  git(tmpDir, ["init", "-q"]);
  git(tmpDir, ["config", "user.name", "Vault Guard Test"]);
  git(tmpDir, ["config", "user.email", "vault-guard@example.invalid"]);
  git(tmpDir, ["branch", "-M", "main"]);
  fs.writeFileSync(path.join(tmpDir, "notes.md"), "initial\n");
  git(tmpDir, ["add", "."]);
  git(tmpDir, ["commit", "-q", "-m", "initial"]);
  git(tmpDir, ["remote", "add", "origin", remoteDir]);
  git(tmpDir, ["push", "-q", "-u", "origin", "main"]);
  for (let index = 1; index <= 6; index += 1) {
    fs.writeFileSync(path.join(tmpDir, "notes.md"), `change ${index}\n`);
    git(tmpDir, ["commit", "-q", "-am", `change ${index}`]);
  }

  try {
    const status = buildVaultGuardStatus(tmpDir);
    assert.equal(status.ahead, 6);
    assert.equal(status.unpushedCommitCount, 6);
    assert.deepEqual(status.recentUnpushedCommitSubjects, ["change 6", "change 5", "change 4", "change 3", "change 2"]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(remoteDir, { recursive: true, force: true });
  }
});

test("detached repositories warn before guarded edits", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-guard-detached-"));
  const git = (args) => execFileSync("git", ["-C", tmpDir, ...args], { stdio: "ignore" });
  git(["init", "-q"]);
  git(["config", "user.name", "Vault Guard Test"]);
  git(["config", "user.email", "vault-guard@example.invalid"]);
  fs.writeFileSync(path.join(tmpDir, "notes.md"), "notes\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "initial"]);
  git(["checkout", "-q", "--detach"]);

  try {
    const status = buildVaultGuardStatus(tmpDir);
    assert.equal(status.isGitRepository, true);
    assert.equal(status.branch, null);
    assert.equal(status.severity, "warn");
    assert.match(status.recommendedNextAction, /Create or select a branch/);
    assert.match(formatStatusText(status), /branch: \(detached\)/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("a deleted upstream branch does not block the vault guard", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-guard-gone-"));
  const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-guard-gone-remote-"));
  const git = (root, args) => execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
  git(remoteDir, ["init", "--bare", "-q"]);
  git(tmpDir, ["init", "-q"]);
  git(tmpDir, ["config", "user.name", "Vault Guard Test"]);
  git(tmpDir, ["config", "user.email", "vault-guard@example.invalid"]);
  git(tmpDir, ["branch", "-M", "main"]);
  fs.writeFileSync(path.join(tmpDir, "notes.md"), "notes\n");
  git(tmpDir, ["add", "."]);
  git(tmpDir, ["commit", "-q", "-m", "initial"]);
  git(tmpDir, ["remote", "add", "origin", remoteDir]);
  git(tmpDir, ["push", "-q", "-u", "origin", "main"]);
  git(remoteDir, ["branch", "-D", "main"]);
  git(tmpDir, ["fetch", "-q", "--prune"]);

  try {
    const status = buildVaultGuardStatus(tmpDir);
    assert.equal(status.branch, "main");
    assert.equal(status.upstream, null);
    assert.deepEqual(status.gitErrors, []);
    assert.equal(status.severity, "ok");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(remoteDir, { recursive: true, force: true });
  }
});

test("scopes nested vault status and ignores inherited git locations", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-guard-"));
  const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-guard-other-"));
  const nestedRoot = path.join(tmpDir, "vault");
  fs.mkdirSync(nestedRoot);
  fs.writeFileSync(path.join(tmpDir, "outside.md"), "outside\n");
  fs.writeFileSync(path.join(nestedRoot, "inside.md"), "inside\n");
  const git = (root, args) => execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
  git(tmpDir, ["init", "-q"]);
  git(tmpDir, ["config", "user.name", "Vault Guard Test"]);
  git(tmpDir, ["config", "user.email", "vault-guard@example.invalid"]);
  git(tmpDir, ["add", "."]);
  git(tmpDir, ["commit", "-q", "-m", "initial"]);
  git(otherDir, ["init", "-q"]);
  fs.writeFileSync(path.join(tmpDir, "outside.md"), "outside changed\n");
  fs.writeFileSync(path.join(nestedRoot, "inside.md"), "inside changed\n");

  const previousGitDir = process.env.GIT_DIR;
  const previousGitWorkTree = process.env.GIT_WORK_TREE;
  process.env.GIT_DIR = path.join(otherDir, ".git");
  process.env.GIT_WORK_TREE = otherDir;
  try {
    const status = buildVaultGuardStatus(nestedRoot);
    assert.equal(status.vaultRoot, path.resolve(nestedRoot));
    assert.deepEqual(status.dirtyPaths.map(({ path: dirtyPath }) => dirtyPath), ["vault/inside.md"]);
    assert.equal(status.gitErrors.length, 0);
  } finally {
    if (previousGitDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = previousGitDir;
    if (previousGitWorkTree === undefined) delete process.env.GIT_WORK_TREE;
    else process.env.GIT_WORK_TREE = previousGitWorkTree;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(otherDir, { recursive: true, force: true });
  }
});

test("creates an owned lock and refuses another owner", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-guard-lock-"));
  const git = (args) => execFileSync("git", ["-C", tmpDir, ...args], { stdio: "ignore" });
  git(["init", "-q"]); git(["config", "user.name", "Vault Guard Test"]); git(["config", "user.email", "vault-guard@example.invalid"]);
  fs.writeFileSync(path.join(tmpDir, "notes.md"), "notes\\n"); git(["add", "."]); git(["commit", "-q", "-m", "initial"]);
  const params = { vaultRoot: tmpDir, issueId: "issue-1", issueIdentifier: "DOT-1", sessionId: "session-1", purpose: "test", owner: { type: "agent", id: "agent-1" } };
  try {
    assert.equal(readVaultGuardLock(tmpDir).state, "none");
    assert.equal(buildVaultGuardStatus(tmpDir).lock.state, "none");
    const first = buildVaultGuardBegin(params);
    assert.equal(first.created, true); assert.equal(first.severity, "ok");
    assert.equal(JSON.parse(fs.readFileSync(lockPath(tmpDir), "utf8")).issueIdentifier, "DOT-1");
    const second = buildVaultGuardBegin({ ...params, sessionId: "session-2", owner: { type: "agent", id: "agent-2" } });
    assert.equal(second.created, false); assert.equal(second.severity, "block");
    const malformed = lockPath(tmpDir); fs.writeFileSync(malformed, "not json");
    assert.equal(readVaultGuardLock(tmpDir).state, "malformed");
    const missing = buildVaultGuardBegin({ vaultRoot: tmpDir });
    assert.equal(missing.severity, "block"); assert.match(missing.message, /missing metadata/);
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});

test("removes a newly created lock marker after a write failure", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-guard-lock-write-failure-"));
  const git = (args) => execFileSync("git", ["-C", tmpDir, ...args], { stdio: "ignore" });
  git(["init", "-q"]); git(["config", "user.name", "Vault Guard Test"]); git(["config", "user.email", "vault-guard@example.invalid"]);
  fs.writeFileSync(path.join(tmpDir, "notes.md"), "notes\n"); git(["add", "."]); git(["commit", "-q", "-m", "initial"]);
  const originalWriteFileSync = fs.writeFileSync;
  const writeError = new Error("simulated lock write failure");
  const params = { vaultRoot: tmpDir, issueId: "issue-1", issueIdentifier: "DOT-1", sessionId: "session-1", purpose: "test", owner: { type: "agent", id: "agent-1" } };
  try {
    fs.writeFileSync = (file, ...args) => {
      if (typeof file === "number") throw writeError;
      return originalWriteFileSync.call(fs, file, ...args);
    };
    syncBuiltinESMExports();
    const result = buildVaultGuardBegin(params);
    assert.equal(result.created, false);
    assert.equal(result.severity, "block");
    assert.match(result.message, /simulated lock write failure/);
    assert.equal(fs.existsSync(lockPath(tmpDir)), false);
  } finally {
    fs.writeFileSync = originalWriteFileSync;
    syncBuiltinESMExports();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("renders structured analyzer output", () => {
  const status = buildVaultGuardStatus(process.cwd());
  assert.equal(JSON.parse(formatStatusJson(status)).vaultRoot, status.vaultRoot);
  assert.match(formatStatusText(status), /ahead\/behind/);
});
