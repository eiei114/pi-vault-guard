import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

test("Pi SDK dogfood covers clean, risky, owned-lock, and other-owner states", { timeout: 15_000 }, async () => {
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

    let toolCallIndex = 0;
    const runTool = async (name, params) => {
      const registration = session.extensionRunner.getAllRegisteredTools()
        .find(({ definition }) => definition.name === name);
      assert.ok(registration, `${name} is registered with Pi`);
      const toolCallId = `sdk-${name}-${++toolCallIndex}`;
      const tool = wrapRegisteredTool(registration, session.extensionRunner);
      return tool.execute(toolCallId, params, AbortSignal.timeout(10_000), undefined);
    };

    const cleanStatus = await runTool("vault_guard_status", { vaultRoot });
    assert.equal(cleanStatus.details.severity, "ok", JSON.stringify(cleanStatus.details));
    assert.equal(cleanStatus.details.dirtyPaths.length, 0);
    assert.equal(cleanStatus.details.lock.state, "none");

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
    assert.equal(ready.details.lock.state, "owned");

    await session.reload();
    const reloaded = await runTool("vault_guard_finish", { vaultRoot, sessionId, removeLock: true });
    assert.equal(reloaded.details.lockRemoved, true, JSON.stringify(reloaded.details));
    assert.equal(reloaded.details.lock.state, "none");
    assert.equal(existsSync(lockPath(vaultRoot)), false);
    assert.equal(existsSync(`${lockPath(vaultRoot)}.begin`), false);

    const settingsPath = path.join(vaultRoot, ".pi", "settings.json");
    const artifactPath = path.join(vaultRoot, "exports", "report.csv");
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    mkdirSync(path.dirname(artifactPath), { recursive: true });
    writeFileSync(settingsPath, "{}\n");
    writeFileSync(artifactPath, "generated\n");
    writeFileSync(path.join(vaultRoot, "notes.md"), "backup fixture\n");
    git(vaultRoot, ["add", "notes.md"]);
    git(vaultRoot, ["commit", "-q", "-m", "Obsidian Git auto backup"]);

    const riskyStatus = await runTool("vault_guard_status", { vaultRoot });
    assert.equal(riskyStatus.details.severity, "warn");
    assert.equal(riskyStatus.details.likelyObsidianGitAutoBackup, true);
    assert.ok(riskyStatus.details.suspiciousDirtyPaths.some(({ path: dirtyPath, reasonCodes }) =>
      dirtyPath === ".pi/settings.json" && reasonCodes.includes("pi-settings")));
    assert.ok(riskyStatus.details.suspiciousDirtyPaths.some(({ path: dirtyPath, reasonCodes }) =>
      dirtyPath === "exports/report.csv" && reasonCodes.includes("export-file")));

    const riskySessionId = "pi-sdk-risky-session";
    const riskyBegin = await runTool("vault_guard_begin", {
      vaultRoot,
      issueId: "pi-sdk-test",
      issueIdentifier: "DOT-1888",
      sessionId: riskySessionId,
      purpose: "verify warning states without persisting vault changes",
      owner: { type: "agent", id: "pi-sdk-test" },
    });
    assert.equal(riskyBegin.details.created, true, JSON.stringify(riskyBegin.details));

    const riskyFinish = await runTool("vault_guard_finish", {
      vaultRoot,
      sessionId: riskySessionId,
      removeLock: true,
    });
    assert.equal(riskyFinish.details.blocked, false, JSON.stringify(riskyFinish.details));
    assert.equal(riskyFinish.details.splitPersistReady, false);
    assert.equal(riskyFinish.details.lockRemoved, true);
    assert.match(riskyFinish.details.warnings.join(" "), /suspicious dirty paths/);
    assert.match(riskyFinish.details.warnings.join(" "), /auto-backup heuristic/);

    const otherSessionId = "pi-sdk-other-owner";
    const otherOwnerBegin = await runTool("vault_guard_begin", {
      vaultRoot,
      issueId: "pi-sdk-test",
      issueIdentifier: "DOT-1888",
      sessionId: otherSessionId,
      purpose: "verify another owner is protected",
      owner: { type: "agent", id: "other-agent" },
    });
    assert.equal(otherOwnerBegin.details.created, true, JSON.stringify(otherOwnerBegin.details));

    const otherOwnerFinish = await runTool("vault_guard_finish", {
      vaultRoot,
      sessionId: "pi-sdk-unrelated-session",
      removeLock: true,
    });
    assert.equal(otherOwnerFinish.details.blocked, true);
    assert.equal(otherOwnerFinish.details.lockRemoved, false);
    assert.match(otherOwnerFinish.details.blockers.join(" "), /active lock belongs to another session/);
    assert.equal(JSON.parse(readFileSync(lockPath(vaultRoot), "utf8")).sessionId, otherSessionId);
  } finally {
    session?.dispose();
    rmSync(vaultRoot, { recursive: true, force: true });
    rmSync(remoteRoot, { recursive: true, force: true });
    rmSync(agentDir, { recursive: true, force: true });
  }
});
