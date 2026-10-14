import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildVaultGuardFinish } from "../lib/finish.ts";
import { buildVaultGuardBegin, lockPath } from "../lib/lock.ts";

function createVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vault-guard-finish-"));
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), "vault-guard-finish-remote-"));
  const git = (directory, args) => execFileSync("git", ["-C", directory, ...args], { stdio: "ignore" });
  git(remote, ["init", "--bare", "-q"]);
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Vault Guard Test"]);
  git(root, ["config", "user.email", "vault-guard@example.invalid"]);
  git(root, ["branch", "-M", "main"]);
  fs.writeFileSync(path.join(root, ".gitignore"), ".pi/vault-guard/\n");
  fs.writeFileSync(path.join(root, "notes.md"), "initial\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "initial"]);
  git(root, ["remote", "add", "origin", remote]);
  git(root, ["push", "-q", "-u", "origin", "main"]);
  return { root, remote, git };
}

function begin(root, sessionId = "session-1") {
  const result = buildVaultGuardBegin({
    vaultRoot: root,
    issueId: "issue-1886",
    issueIdentifier: "DOT-1886",
    sessionId,
    purpose: "test finish gate",
    owner: { type: "agent", id: "agent-1" },
  });
  assert.equal(result.created, true);
}

function cleanup({ root, remote }) {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(remote, { recursive: true, force: true });
}

test("ready finish confirms the owned lock and recommends split persistence", () => {
  const vault = createVault();
  try {
    begin(vault.root);
    const result = buildVaultGuardFinish({ vaultRoot: vault.root, sessionId: "session-1" });
    assert.equal(result.blocked, false);
    assert.equal(result.splitPersistReady, true);
    assert.equal(result.lock.state, "owned");
    assert.match(result.recommendedNextAction, /vault-split-commit\.py --apply --push/);
    assert.equal(result.lockRemoved, false);
  } finally {
    cleanup(vault);
  }
});

test("suspicious dirty paths warn and prevent split-persist readiness", () => {
  const vault = createVault();
  try {
    begin(vault.root);
    fs.mkdirSync(path.join(vault.root, "exports"));
    fs.writeFileSync(path.join(vault.root, "exports", "report.csv"), "generated\n");
    const result = buildVaultGuardFinish({ vaultRoot: vault.root, sessionId: "session-1", removeLock: true });
    assert.equal(result.blocked, false);
    assert.equal(result.severity, "warn");
    assert.equal(result.splitPersistReady, false);
    assert.match(result.warnings.join(" "), /exports\//);
    assert.equal(result.lockRemoved, true);
    assert.equal(fs.existsSync(lockPath(vault.root)), false);
  } finally {
    cleanup(vault);
  }
});

test("another owner's active lock blocks finish and is never removed", () => {
  const vault = createVault();
  try {
    begin(vault.root, "owner-session");
    const result = buildVaultGuardFinish({ vaultRoot: vault.root, sessionId: "caller-session", removeLock: true });
    assert.equal(result.blocked, true);
    assert.equal(result.splitPersistReady, false);
    assert.equal(result.lock.state, "other");
    assert.equal(result.lockRemoved, false);
    assert.equal(JSON.parse(fs.readFileSync(lockPath(vault.root), "utf8")).sessionId, "owner-session");
  } finally {
    cleanup(vault);
  }
});

test("missing owned lock blocks finish", () => {
  const vault = createVault();
  try {
    const result = buildVaultGuardFinish({ vaultRoot: vault.root, sessionId: "session-1" });
    assert.equal(result.blocked, true);
    assert.equal(result.splitPersistReady, false);
    assert.equal(result.lock.state, "none");
    assert.match(result.blockers.join(" "), /no active lock is owned/);
  } finally {
    cleanup(vault);
  }
});

test("removeLock removes only the active lock owned by this session", () => {
  const vault = createVault();
  try {
    begin(vault.root);
    const result = buildVaultGuardFinish({ vaultRoot: vault.root, sessionId: "session-1", removeLock: true });
    assert.equal(result.blocked, false);
    assert.equal(result.splitPersistReady, true);
    assert.equal(result.lockRemoved, true);
    assert.equal(result.lock.state, "none");
    assert.equal(fs.existsSync(lockPath(vault.root)), false);
  } finally {
    cleanup(vault);
  }
});

test("failed lock removal blocks finish and clears split-persist readiness", () => {
  const vault = createVault();
  try {
    begin(vault.root);
    fs.writeFileSync(`${lockPath(vault.root)}.begin`, "held by another operation");

    const result = buildVaultGuardFinish({ vaultRoot: vault.root, sessionId: "session-1", removeLock: true });

    assert.equal(result.blocked, true);
    assert.equal(result.severity, "block");
    assert.equal(result.splitPersistReady, false);
    assert.equal(result.lockRemoved, false);
    assert.match(result.blockers.join(" "), /unable to safely remove owned lock/);
    assert.equal(JSON.parse(fs.readFileSync(lockPath(vault.root), "utf8")).sessionId, "session-1");
  } finally {
    cleanup(vault);
  }
});

test("unpushed Obsidian Git auto-backup-looking commits warn", () => {
  const vault = createVault();
  try {
    begin(vault.root);
    for (let index = 1; index <= 6; index += 1) {
      fs.writeFileSync(path.join(vault.root, "notes.md"), `change ${index}\n`);
      vault.git(vault.root, ["commit", "-q", "-am", index === 1 ? "Obsidian Git auto backup" : `ordinary change ${index}`]);
    }
    const result = buildVaultGuardFinish({ vaultRoot: vault.root, sessionId: "session-1" });
    assert.equal(result.blocked, false);
    assert.equal(result.splitPersistReady, false);
    assert.match(result.warnings.join(" "), /auto-backup state/);
    assert.equal(result.lock.state, "owned");
  } finally {
    cleanup(vault);
  }
});
