import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const handoff = fs.readFileSync(new URL("../PUBLISH_HANDOFF.md", import.meta.url), "utf8");
const changelog = fs.readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const version = packageJson.version;
const tag = `v${version}`;

test("publish handoff release instructions match the package version", () => {
  assert.ok(handoff.includes(`release candidate \`pi-vault-guard@${version}\``));
  assert.ok(handoff.includes(`package.json\` is exactly \`${version}\``));
  assert.ok(handoff.includes("review the `Unreleased` changelog section"));
  assert.ok(handoff.includes(`tag \`${tag}\` does not exist`));
  assert.ok(handoff.includes(`set \`version\` to \`${version}\``));
  assert.ok(handoff.includes(`creates \`${tag}\` and a GitHub release`));

  const unreleasedSection = changelog
    .split(/^## /m)
    .find((section) => section.startsWith("[Unreleased]"));
  assert.ok(unreleasedSection, "CHANGELOG.md must contain an [Unreleased] section");
  assert.ok(
    unreleasedSection.includes(
      "Share Git path separator normalization between dirty-path classification and reason-code generation.",
    ),
    "the refactor changelog entry must appear under [Unreleased]",
  );
});
