import assert from "node:assert/strict";
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
});

test("renders structured analyzer output", () => {
  const status = buildVaultGuardStatus(process.cwd());
  assert.equal(JSON.parse(formatStatusJson(status)).vaultRoot, status.vaultRoot);
  assert.match(formatStatusText(status), /ahead\/behind/);
});
