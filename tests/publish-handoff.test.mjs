import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const handoff = fs.readFileSync(new URL("../PUBLISH_HANDOFF.md", import.meta.url), "utf8");
const version = packageJson.version;
const tag = `v${version}`;

test("publish handoff release instructions match the package version", () => {
  assert.ok(handoff.includes(`release candidate \`pi-vault-guard@${version}\``));
  assert.ok(handoff.includes(`package.json\` is exactly \`${version}\``));
  assert.ok(handoff.includes(`review the \`${version}\` changelog entry`));
  assert.ok(handoff.includes(`tag \`${tag}\` does not exist`));
  assert.ok(handoff.includes(`set \`version\` to \`${version}\``));
  assert.ok(handoff.includes(`creates \`${tag}\` and a GitHub release`));
});
