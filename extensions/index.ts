import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { formatStatusJson, formatStatusText } from "../lib/render-status.ts";
import { buildVaultGuardFinish, type VaultGuardFinishParams, type VaultGuardFinishResult } from "../lib/finish.ts";
import { buildVaultGuardBegin, type VaultGuardBeginParams } from "../lib/lock.ts";
import { buildVaultGuardStatus, type VaultGuardStatusResult } from "../lib/status.ts";

const statusParameters = Type.Object({
  vaultRoot: Type.Optional(Type.String({ description: "Vault root; defaults to the current working directory" })),
  autoBackupSubjectPatterns: Type.Optional(Type.Array(Type.String({
    minLength: 1,
    maxLength: 80,
    description: "Additional literal subject markers; safe built-in patterns always remain enabled",
  }), { maxItems: 10 })),
  autoBackupTimestampWindowMinutes: Type.Optional(Type.Integer({
    minimum: 5,
    maximum: 120,
    description: "Flag a possible backup cadence when three unpushed commits fall within this window",
  })),
});

const beginParameters = Type.Object({
  vaultRoot: Type.Optional(Type.String()),
  issueId: Type.Optional(Type.String()),
  issueIdentifier: Type.Optional(Type.String()),
  sessionId: Type.Optional(Type.String()),
  purpose: Type.Optional(Type.String()),
  owner: Type.Optional(Type.Object({
    type: Type.String(),
    id: Type.String(),
    name: Type.Optional(Type.String()),
  })),
  allowExistingOwnedLock: Type.Optional(Type.Boolean()),
});

const finishParameters = Type.Object({
  vaultRoot: Type.Optional(Type.String({ description: "Vault root; defaults to the current working directory" })),
  sessionId: Type.String({ minLength: 1, description: "Session ID supplied to vault_guard_begin" }),
  removeLock: Type.Optional(Type.Boolean({ description: "Remove this session's lock only when finish is not blocked" })),
});

export default function (pi: ExtensionAPI) {
  pi.registerCommand("vault-guard:status", {
    description: "Show Vault Guard status from read-only git analysis",
    handler: async (args, ctx) => {
      const status = buildVaultGuardStatus(args.trim() || undefined);
      const text = formatStatusText(status);

      if (ctx.hasUI) {
        ctx.ui.notify("Vault Guard status collected", "info");
      }

      console.log(text);
    },
  });

  pi.registerTool({
    name: "vault_guard_begin",
    label: "Vault Guard Begin",
    description: "Preflight a vault and create a run-owned advisory lock marker",
    promptSnippet: "vault_guard_begin: claim a vault mutation run before editing",
    promptGuidelines: [
      "Provide issue, session, purpose, and owner metadata before making guarded edits.",
      "Never proceed when another active owner holds the lock.",
    ],
    parameters: beginParameters,
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) return { content: [{ type: "text", text: "Cancelled" }], details: {} };
      const result = buildVaultGuardBegin(params as VaultGuardBeginParams);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
    },
    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("vault_guard_begin")), 0, 0);
    },
    renderResult(result, { expanded }, theme) {
      const text = result.content[0]?.type === "text" ? result.content[0].text : "no result";
      return new Text(theme.fg("text", expanded ? text : text.split("\n").find((line) => line.includes('"message"')) ?? text), 0, 0);
    },
  });

  pi.registerTool({
    name: "vault_guard_status",
    label: "Vault Guard Status",
    description:
      "Return a read-only git-backed vault status snapshot including branch, dirty paths, and unpushed commits",
    promptSnippet: "vault_guard_status: inspect vault guard readiness before editing a git-backed vault",
    promptGuidelines: [
      "Use vault_guard_status before vault mutation work to inspect branch and dirty state.",
      "Review suspicious paths and recommendedNextAction before editing.",
    ],
    parameters: statusParameters,
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      if (signal?.aborted) {
        return { content: [{ type: "text", text: "Cancelled" }], details: {} };
      }

      const status = buildVaultGuardStatus(params.vaultRoot, {
        autoBackupSubjectPatterns: params.autoBackupSubjectPatterns,
        autoBackupTimestampWindowMinutes: params.autoBackupTimestampWindowMinutes,
      });
      const json = formatStatusJson(status);

      return {
        content: [{ type: "text", text: json }],
        details: status,
      };
    },

    renderCall(_args, theme, _context) {
      return new Text(theme.fg("toolTitle", theme.bold("vault_guard_status")), 0, 0);
    },

    renderResult(result, { expanded }, theme, _context) {
      const details = result.details as VaultGuardStatusResult | undefined;
      const content = result.content[0];
      const fallback = content?.type === "text" ? content.text : "";
      const status = details ?? (fallback ? (JSON.parse(fallback) as VaultGuardStatusResult) : undefined);

      if (!status) {
        return new Text(theme.fg("dim", "no status"), 0, 0);
      }

      let text = theme.fg("success", "→ ") + theme.fg("text", formatStatusText(status));
      if (expanded) {
        text += `\n${theme.fg("dim", formatStatusJson(status))}`;
      }
      return new Text(text, 0, 0);
    },
  });

  pi.registerTool({
    name: "vault_guard_finish",
    label: "Vault Guard Finish",
    description: "Re-check vault and run-owned lock readiness before split persistence; never persists changes itself",
    promptSnippet: "vault_guard_finish: check split-persist readiness after guarded edits",
    promptGuidelines: [
      "Pass the same sessionId used by vault_guard_begin so finish can verify lock ownership.",
      "Resolve blockers and review warnings before running the recommended persistence command.",
      "This tool never commits, pushes, resets, stashes, or cleans the vault.",
    ],
    parameters: finishParameters,
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) return { content: [{ type: "text", text: "Cancelled" }], details: {} };
      const result = buildVaultGuardFinish(params as VaultGuardFinishParams);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
    },
    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("vault_guard_finish")), 0, 0);
    },
    renderResult(result, { expanded }, theme) {
      const details = result.details as VaultGuardFinishResult | undefined;
      const text = result.content[0]?.type === "text" ? result.content[0].text : "no result";
      return new Text(theme.fg(details?.blocked ? "error" : details?.severity === "warn" ? "warning" : "success", expanded ? text : details?.message ?? text), 0, 0);
    },
  });
}
