import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { buildVaultGuardBegin, lockPath } from "../../lib/lock.ts";

const [root, session, pause] = process.argv.slice(2);
const originalRead = fs.readFileSync;
let reads = 0;
fs.readFileSync = function (file, ...args) {
  const value = originalRead.call(this, file, ...args);
  if (file === lockPath(root) && ++reads === 2 && pause === "pause") {
    process.send({ boundary: "stale_snapshot" });
    const until = Date.now() + 10_000;
    while (!fs.existsSync(`${root}/resume`) && Date.now() < until) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
    if (!fs.existsSync(`${root}/resume`)) throw new Error("stale snapshot barrier timed out");
  }
  return value;
};
syncBuiltinESMExports();
const result = buildVaultGuardBegin({
  vaultRoot: root, issueId: "issue", issueIdentifier: "DOT-1", sessionId: session,
  purpose: "concurrency regression", owner: { type: "agent", id: session },
});
process.send({ result });
process.disconnect();
