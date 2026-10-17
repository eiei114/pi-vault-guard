import type { VaultGuardStatusResult } from "./status.ts";
import { escapePathForDisplay } from "./path-display.ts";

/**
 * Human-readable status text shared by `/vault-guard:status` and tool renderers.
 */
export function formatStatusText(status: VaultGuardStatusResult): string {
  const lines = [
    "Vault Guard status",
    `  vault root: ${status.vaultRoot}`,
    `  guard version: ${status.guardVersion}`,
    `  severity: ${status.severity}`,
    `  branch: ${status.isGitRepository ? status.branch ?? "(detached)" : "(not a git repository)"}`,
    `  upstream: ${status.upstream ?? "(none)"}`,
    `  ahead/behind: ${status.ahead}/${status.behind}`,
    `  risky paths: ${status.suspiciousDirtyPaths.length}`,
    ...status.suspiciousDirtyPaths.slice(0, 3).map(({ path, reasonCodes, reasons, tracking }) =>
      `    ${escapePathForDisplay(path)} [${reasonCodes.join(", ")}; ${tracking}] — ${reasons.join("; ")}`,
    ),
    ...(status.suspiciousDirtyPaths.length > 3
      ? [`    …and ${status.suspiciousDirtyPaths.length - 3} more`]
      : []),
    `  unpushed commits: ${status.unpushedCommitCount}`,
    ...(status.likelyObsidianGitAutoBackup
      ? [
          "  possible Obsidian Git auto-backup: heuristic match; verify before acting",
          `  signals: ${status.obsidianGitAutoBackupSignals.map(escapePathForDisplay).join("; ")}`,
          "  config guidance (dry-run): review plugin settings yourself; no config was changed",
        ]
      : []),
    ...(status.gitErrors.length > 0 ? [`  git errors: ${status.gitErrors.join("; ")}`] : []),
    `  next action: ${status.recommendedNextAction}`,
    `  message: ${status.message}`,
  ];
  return lines.join("\n");
}

/**
 * Structured JSON payload for agent tools.
 */
export function formatStatusJson(status: VaultGuardStatusResult): string {
  return JSON.stringify(status, null, 2);
}
