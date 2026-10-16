import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import test from "node:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const script = resolve(root, "scripts/pi-sdk-smoke.mjs");
const timeout = 120_000;

function run(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout,
    windowsHide: true,
  });
}

function assertSmokeSucceeded(result, label) {
  assert.equal(result.error, undefined, `${label} failed to start or timed out: ${result.error?.message ?? ""}`);
  assert.equal(result.status, 0, `${label} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
}

test("normal smoke preserves the committed report and --record updates it", () => {
  const trackedReport = resolve(root, "docs/verification/pi-sdk-smoke.json");
  const committedBytes = readFileSync(trackedReport);
  const npmCli = process.env.npm_execpath;
  const normalRun = npmCli
    ? run(process.execPath, [npmCli, "run", "smoke:pi"], root)
    : process.platform === "win32"
      ? run(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm run smoke:pi"], root)
      : run("npm", ["run", "smoke:pi"], root);
  assertSmokeSucceeded(normalRun, "npm run smoke:pi");
  assert.deepEqual(readFileSync(trackedReport), committedBytes, "normal smoke execution changed the committed report");

  const runtimeReport = JSON.parse(readFileSync(resolve(root, "tmp/pi-sdk-smoke.json"), "utf8"));
  assert.equal(runtimeReport.verification_contract, "pi-sdk-behavior-v2");
  assert.ok(runtimeReport.cases.every((item) => item.passed));

  const sandbox = mkdtempSync(resolve(tmpdir(), "pi-sdk-smoke-record-"));
  try {
    for (const directory of ["scripts", "extensions", "lib"]) {
      cpSync(resolve(root, directory), resolve(sandbox, directory), { recursive: true });
    }
    cpSync(resolve(root, "package.json"), resolve(sandbox, "package.json"));
    symlinkSync(resolve(root, "node_modules"), resolve(sandbox, "node_modules"),
      process.platform === "win32" ? "junction" : "dir");

    const sandboxReport = resolve(sandbox, "docs/verification/pi-sdk-smoke.json");
    const sentinel = Buffer.from("explicit record should replace this report\n");
    mkdirSync(resolve(sandbox, "docs/verification"), { recursive: true });
    writeFileSync(sandboxReport, sentinel);

    const recordRun = run(process.execPath, [resolve(sandbox, "scripts/pi-sdk-smoke.mjs"), "--record"], sandbox);
    assertSmokeSucceeded(recordRun, "node scripts/pi-sdk-smoke.mjs --record");
    const recordedBytes = readFileSync(sandboxReport);
    assert.notDeepEqual(recordedBytes, sentinel, "--record did not update the tracked report");
    const recordedReport = JSON.parse(recordedBytes.toString("utf8"));
    assert.equal(recordedReport.verification_contract, "pi-sdk-behavior-v2");
    assert.ok(recordedReport.cases.every((item) => item.passed));
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
