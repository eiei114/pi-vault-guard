import type { VaultGuardStatusResult } from "./status.ts";

/**
 * Human-readable status text shared by `/vault-guard:status` and tool renderers.
 */
export function formatStatusText(status: VaultGuardStatusResult): string {
  return [
    "Vault Guard status",
    `  vault root: ${status.vaultRoot}`,
    `  guard version: ${status.guardVersion}`,
    `  severity: ${status.severity}`,
    `  branch: ${status.isGitRepository ? status.branch ?? "(detached)" : "(not a git repository)"}`,
    `  upstream: ${status.upstream ?? "(none)"}`,
    `  ahead/behind: ${status.ahead}/${status.behind}`,
    `  dirty paths: ${status.dirtyPaths.length}`,
    `  suspicious paths: ${status.suspiciousPaths.length}`,
    `  unpushed commits: ${status.unpushedCommitCount}`,
    `  likely Obsidian Git auto-backup: ${status.likelyObsidianGitAutoBackup}`,
    `  git errors: ${status.gitErrors.length > 0 ? status.gitErrors.join("; ") : "(none)"}`,
    `  next action: ${status.recommendedNextAction}`,
    `  message: ${status.message}`,
  ].join("\n");
}

/**
 * Structured JSON payload for agent tools.
 */
export function formatStatusJson(status: VaultGuardStatusResult): string {
  return JSON.stringify(status, null, 2);
}
