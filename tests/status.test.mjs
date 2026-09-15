import assert from "node:assert/strict";
import test from "node:test";
import { formatStatusJson, formatStatusText } from "../lib/render-status.ts";
import { buildVaultGuardStatus } from "../lib/status.ts";

test("buildVaultGuardStatus returns walking skeleton stub fields", () => {
  const status = buildVaultGuardStatus("/tmp/example-vault");

  assert.equal(status.vaultRoot, "/tmp/example-vault");
  assert.equal(status.severity, "warn");
  assert.match(status.message, /status analyzer not implemented yet/i);
  assert.match(status.guardVersion, /^\d+\.\d+\.\d+/);
});

test("formatStatusText renders readable multi-line output", () => {
  const status = buildVaultGuardStatus("/vault/root");
  const text = formatStatusText(status);

  assert.match(text, /Vault Guard status/);
  assert.match(text, /vault root: \/vault\/root/);
  assert.match(text, /severity: warn/);
  assert.match(text, /status analyzer not implemented yet/);
});

test("formatStatusJson returns structured JSON", () => {
  const status = buildVaultGuardStatus("/vault/root");
  const parsed = JSON.parse(formatStatusJson(status));

  assert.deepEqual(parsed, status);
});
