import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  wrapRegisteredTool,
} from "@earendil-works/pi-coding-agent";
import { lockPath } from "../lib/lock.ts";

test("Pi SDK loads, runs, reloads, and cleans up the finish tool", { timeout: 15_000 }, async () => {
  const root = process.cwd();
  const vaultRoot = mkdtempSync(path.join(os.tmpdir(), "pi-vault-guard-sdk-vault-"));
  const remoteRoot = mkdtempSync(path.join(os.tmpdir(), "pi-vault-guard-sdk-remote-"));
  const agentDir = mkdtempSync(path.join(os.tmpdir(), "pi-vault-guard-sdk-agent-"));
  const git = (directory, args) => execFileSync("git", ["-C", directory, ...args], { stdio: "ignore" });
  let session;

  try {
    git(remoteRoot, ["init", "--bare", "-q"]);
    git(vaultRoot, ["init", "-q"]);
    git(vaultRoot, ["config", "user.name", "Pi SDK Test"]);
    git(vaultRoot, ["config", "user.email", "pi-sdk-test@example.invalid"]);
    git(vaultRoot, ["branch", "-M", "main"]);
    writeFileSync(path.join(vaultRoot, ".gitignore"), ".pi/vault-guard/\n");
    writeFileSync(path.join(vaultRoot, "notes.md"), "initial\n");
    git(vaultRoot, ["add", "."]);
    git(vaultRoot, ["commit", "-q", "-m", "initial"]);
    git(vaultRoot, ["remote", "add", "origin", remoteRoot]);
    git(vaultRoot, ["push", "-q", "-u", "origin", "main"]);

    const settingsManager = SettingsManager.create(root, agentDir);
    const resourceLoader = new DefaultResourceLoader({
      cwd: root,
      agentDir,
      settingsManager,
      additionalExtensionPaths: [path.join(root, "extensions", "index.ts")],
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await resourceLoader.reload();
    ({ session } = await createAgentSession({
      cwd: root,
      agentDir,
      settingsManager,
      resourceLoader,
      sessionManager: SessionManager.inMemory(root),
      noTools: "all",
    }));

    const runTool = async (name, params) => {
      const registration = session.extensionRunner.getAllRegisteredTools()
        .find(({ definition }) => definition.name === name);
      assert.ok(registration, `${name} is registered with Pi`);
      const toolCallId = `sdk-${name}`;
      const tool = wrapRegisteredTool(registration, session.extensionRunner);
      return tool.execute(toolCallId, params, AbortSignal.timeout(10_000), undefined);
    };

    const sessionId = "pi-sdk-session";
    const begin = await runTool("vault_guard_begin", {
      vaultRoot,
      issueId: "pi-sdk-test",
      issueIdentifier: "DOT-1886",
      sessionId,
      purpose: "verify Pi-hosted finish tool",
      owner: { type: "agent", id: "pi-sdk-test" },
    });
    assert.equal(begin.details.created, true, JSON.stringify(begin.details));

    const ready = await runTool("vault_guard_finish", { vaultRoot, sessionId });
    assert.equal(ready.details.splitPersistReady, true, JSON.stringify(ready.details));
    assert.equal(ready.details.blocked, false);

    await session.reload();
    const reloaded = await runTool("vault_guard_finish", { vaultRoot, sessionId, removeLock: true });
    assert.equal(reloaded.details.lockRemoved, true, JSON.stringify(reloaded.details));
    assert.equal(reloaded.details.lock.state, "none");
    assert.equal(existsSync(lockPath(vaultRoot)), false);
    assert.equal(existsSync(`${lockPath(vaultRoot)}.begin`), false);

    const missingLock = await runTool("vault_guard_finish", { vaultRoot, sessionId });
    assert.equal(missingLock.details.blocked, true, JSON.stringify(missingLock.details));
    assert.match(missingLock.details.blockers.join(" "), /no active lock is owned/);
  } finally {
    session?.dispose();
    rmSync(vaultRoot, { recursive: true, force: true });
    rmSync(remoteRoot, { recursive: true, force: true });
    rmSync(agentDir, { recursive: true, force: true });
  }
});
