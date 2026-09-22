import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { classifyDirtyPath, parseAheadBehind, parsePorcelainStatus, buildVaultGuardStatus } from "../lib/status.ts";
import { formatStatusJson, formatStatusText } from "../lib/render-status.ts";

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

test("non-git directories return a controlled warning", () => {
  const status = buildVaultGuardStatus("/path/that/does/not/exist");
  assert.equal(status.isGitRepository, false);
  assert.equal(status.severity, "warn");
  assert.match(status.message, /not a git repository/);
  assert.match(formatStatusText(status), /not a git repository/);
});

test("detached repositories warn before guarded edits", () => {
  const status = buildVaultGuardStatus(process.cwd());
  assert.equal(status.branch, null);
  assert.equal(status.severity, "warn");
  assert.match(status.recommendedNextAction, /Create or select a branch/);
  assert.match(formatStatusText(status), /branch: \(detached\)/);
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

test("renders structured analyzer output", () => {
  const status = buildVaultGuardStatus(process.cwd());
  assert.equal(JSON.parse(formatStatusJson(status)).vaultRoot, status.vaultRoot);
  assert.match(formatStatusText(status), /ahead\/behind/);
});
