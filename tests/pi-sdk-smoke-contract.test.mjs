import assert from "node:assert/strict";
import test from "node:test";
import {
  behaviorAssertions,
  parseJsonLines,
  PROBE_TIMEOUT_MS,
  VERIFICATION_CONTRACT,
} from "../scripts/pi-sdk-smoke-contract.mjs";

const command = { name: "vault-guard:status", source: "extension" };
const commands = { type: "response", id: "commands", command: "get_commands", success: true, data: { commands: [command] } };
const prompt = { type: "response", id: "feature", command: "prompt", success: true, data: { disposition: "handled" } };
const notification = { type: "extension_ui_request", method: "notify", message: "Vault Guard status collected" };
const cleanOutput = "Vault Guard status\n  vault root: C:/vault\n  severity: ok\n  message: vault is clean\n";
const errorOutput = "Vault Guard status\n  vault root: C:/not-a-vault\n  severity: warn\n  message: vault root is not a git repository\n";
const observed = (responses = [commands, prompt, notification], fullOutput = cleanOutput, exit_code = 0) => ({
  responses,
  fullOutput,
  exit_code,
  expectedVersion: "1.2.0",
  vaultRoot: "C:/vault",
  nonGitRoot: "C:/not-a-vault",
});

test("behavior contract and bounded JSONL parsing", () => {
  assert.equal(VERIFICATION_CONTRACT, "pi-sdk-behavior-v2");
  assert.equal(PROBE_TIMEOUT_MS, 15_000);
  assert.deepEqual(parseJsonLines(`not-json\r\n${JSON.stringify(prompt)}\n\n`), [prompt]);
});

test("extension registration requires the actual named extension command", () => {
  assert.equal(behaviorAssertions("extension_load", observed())[0].passed, true);
  for (const bad of [[], [{ ...commands, success: false }], [
    { ...commands, data: { commands: [{ ...command, name: "other" }] } },
  ]]) {
    assert.equal(behaviorAssertions("extension_load", observed(bad))[0].passed, false);
  }
});

test("happy path requires a handled prompt, feature notification, and clean status", () => {
  assert.equal(behaviorAssertions("happy_path", observed())[0].passed, true);
  for (const [responses, output] of [
    [[], cleanOutput],
    [[commands, { ...prompt, success: false }, notification], cleanOutput],
    [[commands, { ...prompt, data: { disposition: "started" } }, notification], cleanOutput],
    [[commands, prompt], cleanOutput],
    [[commands, prompt, notification], cleanOutput.replace("vault is clean", "vault requires review")],
  ]) {
    assert.equal(behaviorAssertions("happy_path", observed(responses, output))[0].passed, false);
  }
});

test("negative vault result requires a handled warning and an observed parse failure", () => {
  const parseError = { type: "response", command: "parse", success: false, error: "Invalid JSON" };
  assert.equal(behaviorAssertions("error_path", observed(
    [commands, prompt, notification, parseError], errorOutput,
  ))[0].passed, true);
  for (const [responses, output] of [
    [[commands, prompt, notification], errorOutput],
    [[commands, prompt, notification, { ...parseError, success: true }], errorOutput],
    [[commands, prompt, notification, parseError], cleanOutput],
    [[commands, { ...prompt, success: false }, notification, parseError], errorOutput],
  ]) {
    assert.equal(behaviorAssertions("error_path", observed(responses, output))[0].passed, false);
  }
});

test("reload requires real second-process registration and feature response", () => {
  const second = {
    responses: [commands, prompt, notification],
    fullOutput: cleanOutput,
    exit_code: 0,
  };
  const good = behaviorAssertions("reload_cleanup", {
    ...observed([commands]),
    secondProcess: second,
  });
  assert.deepEqual(good.map((item) => item.id), [
    "reloaded_extension_registered", "reloaded_feature_response", "clean_shutdown",
  ]);
  assert.ok(good.every((item) => item.passed));
  for (const responses of [[], [commands], [commands, prompt], [prompt, notification]]) {
    const checks = behaviorAssertions("reload_cleanup", {
      ...observed([commands]),
      secondProcess: { ...second, responses },
    });
    if (responses.includes(prompt) && responses.includes(notification)) {
      assert.equal(checks[0].passed, false);
    } else {
      assert.equal(checks[1].passed, false);
    }
  }
});

test("clean shutdown requires both actual processes to exit zero without errors", () => {
  const base = observed([commands]);
  for (const [firstExit, secondExit, firstOutput, secondOutput] of [
    [1, 0, "", ""],
    [0, 1, "", ""],
    [0, 0, "shutdown error", ""],
    [0, 0, "", "UnhandledPromiseRejection"],
  ]) {
    const checks = behaviorAssertions("reload_cleanup", {
      ...base,
      exit_code: firstExit,
      fullOutput: firstOutput,
      secondProcess: { responses: [commands, prompt, notification], fullOutput: secondOutput, exit_code: secondExit },
    });
    assert.equal(checks[2].passed, false);
  }
});

test("host shell requires exact pinned version and successful exit", () => {
  assert.equal(behaviorAssertions("host_shell", observed([], "1.2.0\r\n"))[0].passed, true);
  for (const [output, exitCode] of [["", 0], ["1.2.0-extra", 0], ["1.2.0", 1], ["1.1.0", 0]]) {
    assert.equal(behaviorAssertions("host_shell", observed([], output, exitCode))[0].passed, false);
  }
});
