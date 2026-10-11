import assert from "node:assert/strict";
import { execFileSync, fork } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildVaultGuardBegin, lockPath, LOCK_STALE_AFTER_MS } from "../lib/lock.ts";

const worker = fileURLToPath(new URL("./fixtures/stale-lock-worker.mjs", import.meta.url));
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vault-guard-takeover-"));
  execFileSync("git", ["-C", root, "init", "-q"]);
  const params = { vaultRoot: root, issueId: "issue", issueIdentifier: "DOT-1", sessionId: "old",
    purpose: "test", owner: { type: "agent", id: "old" } };
  assert.equal(buildVaultGuardBegin(params).created, true);
  const lock = JSON.parse(fs.readFileSync(lockPath(root), "utf8"));
  lock.createdAt = new Date(Date.now() - LOCK_STALE_AFTER_MS - 60_000).toISOString();
  fs.writeFileSync(lockPath(root), JSON.stringify(lock));
  return { root, params };
}
function launch(root, session, pause = "") {
  const child = fork(worker, [root, session, pause], { execArgv: [], stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const boundary = new Promise((resolve) => child.on("message", (msg) => { if (msg.boundary) resolve(msg); }));
  let result;
  child.on("message", (msg) => { if (msg.result) result = msg.result; });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 && result ? resolve(result) : reject(new Error(`worker failed ${code}: ${stderr}`)));
  });
  return { child, boundary, exited };
}

test("stale takeover cannot delete another concurrent begin's new marker", { timeout: 20_000 }, async () => {
  const { root } = fixture();
  const children = [];
  try {
    const a = launch(root, "session-a", "pause"); children.push(a.child);
    await Promise.race([a.boundary, a.exited.then(() => { throw new Error("snapshot boundary missing"); })]);
    const b = launch(root, "session-b"); children.push(b.child);
    const bResult = await b.exited;
    fs.writeFileSync(path.join(root, "resume"), "resume");
    const aResult = await a.exited;
    assert.equal(Number(aResult.created) + Number(bResult.created), 1, "only one process may acquire the stale lock");
    assert.equal(aResult.created, true);
    assert.equal(bResult.created, false);
    assert.equal(JSON.parse(fs.readFileSync(lockPath(root), "utf8")).sessionId, "session-a");
    assert.equal(fs.existsSync(`${lockPath(root)}.begin`), false);
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an existing begin guard never authorizes removal of an aged marker", () => {
  const { root, params } = fixture();
  try {
    const before = fs.readFileSync(lockPath(root), "utf8");
    fs.writeFileSync(`${lockPath(root)}.begin`, "crashed or active begin");
    const result = buildVaultGuardBegin({ ...params, sessionId: "new" });
    assert.equal(result.created, false);
    assert.equal(result.severity, "block");
    assert.equal(fs.readFileSync(lockPath(root), "utf8"), before);
    assert.equal(fs.existsSync(`${lockPath(root)}.begin`), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
