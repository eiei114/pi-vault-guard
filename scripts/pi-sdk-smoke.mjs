import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  behaviorAssertions,
  EXTENSION_LOAD_ERROR_PATTERN,
  parseJsonLines,
  PROBE_TIMEOUT_MS,
  SDK_NAMES,
  UNHANDLED_ERROR_PATTERN,
  VERIFICATION_CONTRACT,
} from "./pi-sdk-smoke-contract.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = resolve(root, "docs/verification/pi-sdk-smoke.json");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const manifest = readJson(resolve(root, "package.json"));
const sdkVersions = Object.fromEntries(SDK_NAMES.map((name) => {
  const version = readJson(resolve(root, "node_modules", name, "package.json")).version;
  if (manifest.devDependencies?.[name] !== version || version !== "1.2.0") {
    throw new Error(`Smoke requires ${name} pinned and installed at 1.2.0; found ${manifest.devDependencies?.[name]} / ${version}`);
  }
  return [name, version];
}));

const codingAgentRoot = resolve(root, "node_modules/@earendil-works/pi-coding-agent");
const piManifest = readJson(resolve(codingAgentRoot, "package.json"));
const piCli = resolve(codingAgentRoot, piManifest.bin.pi);
const scratchRoot = mkdtempSync(resolve(tmpdir(), "pi-vault-guard-smoke-"));
const agentDir = resolve(scratchRoot, "agent");
const vaultRoot = resolve(scratchRoot, "vault");
const nonGitRoot = resolve(scratchRoot, "not-a-vault");
mkdirSync(agentDir, { recursive: true });
mkdirSync(vaultRoot, { recursive: true });
mkdirSync(nonGitRoot, { recursive: true });

const env = {
  ...process.env,
  PI_CODING_AGENT_DIR: agentDir,
  PI_CODING_AGENT_SESSION_DIR: resolve(agentDir, "sessions"),
  PI_OFFLINE: "1",
  PI_TELEMETRY: "0",
};
const rpcArgs = [piCli, "--offline", "--no-session", "--no-tools", "--no-extensions", "--no-skills",
  "--no-context-files", "--no-prompt-templates", "--no-themes", "--no-mcp", "-e", ".", "--mode", "rpc"];
const git = (directory, args) => spawnSync("git", ["-C", directory, ...args], {
  cwd: root,
  env: { ...env, GIT_CONFIG_NOSYSTEM: "1" },
  encoding: "utf8",
  timeout: PROBE_TIMEOUT_MS,
  windowsHide: true,
});

function checkGit(args) {
  const result = git(vaultRoot, args);
  if (result.error || result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.error?.message || result.status}`);
  }
}

function runBounded(executable, args, input = "") {
  return new Promise((resolveResult) => {
    const child = spawn(executable, args, {
      cwd: root,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let processError = null;
    let exitCode = null;
    let timedOut = false;
    let settled = false;
    let deadlineTimer;
    let cleanupTimer;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      clearTimeout(cleanupTimer);
      const fullOutput = `${stdout}${stderr}`;
      resolveResult({
        stdout,
        stderr,
        fullOutput,
        exit_code: exitCode ?? -1,
        timedOut,
        processExited: exitCode !== null,
        processError,
        responses: parseJsonLines(stdout),
      });
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdin.on("error", () => {});
    child.once("error", (error) => { processError = error.message; });
    child.once("exit", (code) => { exitCode = code; });
    child.once("close", (code) => {
      if (code !== null) exitCode = code;
      finish();
    });

    deadlineTimer = setTimeout(() => {
      timedOut = true;
      const cleanupEndsAt = Date.now() + 1_000;
      if (Number.isInteger(child.pid)) {
        if (process.platform === "win32") {
          const taskkill = resolve(process.env.SystemRoot ?? "C:/Windows", "System32", "taskkill.exe");
          spawnSync(taskkill, ["/F", "/T", "/PID", String(child.pid)], {
            encoding: "utf8",
            timeout: 500,
            windowsHide: true,
          });
        } else {
          try { process.kill(-child.pid, "SIGKILL"); } catch {}
        }
      }
      try { child.kill("SIGKILL"); } catch {}
      cleanupTimer = setTimeout(finish, Math.max(0, cleanupEndsAt - Date.now()));
    }, PROBE_TIMEOUT_MS);

    child.stdin.end(input);
  });
}

function rpcInput(records) {
  return `${records.map((record) => typeof record === "string" ? record : JSON.stringify(record)).join("\n")}\n`;
}

function runRpc(records) {
  return runBounded(process.execPath, rpcArgs, rpcInput(records));
}

function evaluate(name, result, extra = {}) {
  const assertions = behaviorAssertions(name, {
    responses: result.responses,
    fullOutput: result.fullOutput,
    exit_code: result.exit_code,
    expectedVersion: sdkVersions["@earendil-works/pi-coding-agent"],
    vaultRoot,
    nonGitRoot,
    ...extra,
  });
  const secondOutput = extra.secondProcess?.fullOutput ?? "";
  const hasUnhandledError = UNHANDLED_ERROR_PATTERN.test(result.fullOutput)
    || UNHANDLED_ERROR_PATTERN.test(secondOutput);
  const hasLoadError = EXTENSION_LOAD_ERROR_PATTERN.test(result.fullOutput)
    || EXTENSION_LOAD_ERROR_PATTERN.test(secondOutput);
  const passed = result.processExited && !result.timedOut && !result.processError
    && result.exit_code === 0 && !hasUnhandledError && !hasLoadError
    && assertions.every((item) => item.passed);
  const evidence = `${result.fullOutput}${secondOutput ? `\n--- second Pi process ---\n${secondOutput}` : ""}`
    .replaceAll(root, "<checkout>")
    .replaceAll(root.replaceAll("\\", "\\\\"), "<checkout>")
    .replaceAll(scratchRoot, "<smoke-temp>")
    .replaceAll(scratchRoot.replaceAll("\\", "\\\\"), "<smoke-temp>");
  return {
    name,
    command: "npm run smoke:pi",
    deadline_ms: PROBE_TIMEOUT_MS,
    exit_code: result.exit_code,
    passed,
    evidence: `${evidence}${result.processError ? `\n${result.processError}` : ""}`.slice(-6000)
      || "No output captured",
    assertions,
    hasUnhandledError,
    hasLoadError,
    timedOut: result.timedOut,
    processExited: result.processExited,
  };
}

function nativeShellCase() {
  const expectedVersion = sdkVersions["@earendil-works/pi-coding-agent"];
  if (process.platform === "win32") {
    const shell = resolve(process.env.SystemRoot ?? "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
    const quote = (value) => `'${value.replaceAll("'", "''")}'`;
    return runBounded(shell, ["-NoProfile", "-NonInteractive", "-Command",
      `& ${quote(process.execPath)} ${quote(piCli)} --no-extensions --version; exit $LASTEXITCODE`]);
  }
  return runBounded("/bin/sh", ["-c", '"$1" "$2" --no-extensions --version', "pi-host-shell", process.execPath, piCli]);
}

try {
  checkGit(["init", "-q"]);
  checkGit(["config", "user.name", "Pi SDK Smoke"]);
  checkGit(["config", "user.email", "pi-sdk-smoke@example.invalid"]);
  checkGit(["branch", "-M", "main"]);
  writeFileSync(resolve(vaultRoot, "notes.md"), "clean fixture\n");
  checkGit(["add", "."]);
  checkGit(["commit", "-q", "-m", "initial fixture"]);

  const extensionLoad = evaluate("extension_load", await runRpc([{ id: "commands", type: "get_commands" }]));
  const happyPath = evaluate("happy_path", await runRpc([
    { id: "commands", type: "get_commands" },
    { id: "feature", type: "prompt", message: `/vault-guard:status ${vaultRoot}` },
  ]));
  const errorPath = evaluate("error_path", await runRpc([
    { id: "commands", type: "get_commands" },
    { id: "feature", type: "prompt", message: `/vault-guard:status ${nonGitRoot}` },
    "not-json",
  ]));

  const firstProcess = await runRpc([{ id: "commands", type: "get_commands" }]);
  const secondProcess = await runRpc([
    { id: "commands", type: "get_commands" },
    { id: "feature", type: "prompt", message: `/vault-guard:status ${vaultRoot}` },
  ]);
  const reloadCleanup = evaluate("reload_cleanup", firstProcess, {
    secondProcess: {
      responses: secondProcess.responses,
      fullOutput: secondProcess.fullOutput,
      exit_code: secondProcess.exit_code,
    },
  });

  const hostShell = evaluate("host_shell", await nativeShellCase());
  const cases = [extensionLoad, happyPath, errorPath, reloadCleanup, hostShell];
  const report = {
    schema_version: 1,
    verification_contract: VERIFICATION_CONTRACT,
    sdk_versions: sdkVersions,
    platform: process.platform,
    model_inference: "none; actual Pi RPC host executes the package's status command; tool behavior is covered by the real SDK session regression",
    unhandled_errors: cases.filter((item) => item.hasUnhandledError).length,
    extension_load_errors: cases.filter((item) => item.hasLoadError
      || (item.name === "extension_load" && !item.passed)).length,
    cases: cases.map(({ hasUnhandledError, hasLoadError, timedOut, processExited, ...item }) => item),
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    verification_contract: VERIFICATION_CONTRACT,
    platform: process.platform,
    cases: cases.map(({ name, passed, exit_code, timedOut, processExited }) => ({
      name, passed, exit_code, timedOut, processExited,
    })),
  }));
  if (cases.some((item) => !item.passed)) process.exitCode = 1;
} finally {
  rmSync(scratchRoot, { recursive: true, force: true });
}
