import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { formatStatusJson, formatStatusText } from "../lib/render-status.ts";
import { buildVaultGuardStatus, type VaultGuardStatusResult } from "../lib/status.ts";

const statusParameters = Type.Object({
  vaultRoot: Type.Optional(Type.String({ description: "Vault root; defaults to the current working directory" })),
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

      const status = buildVaultGuardStatus(params.vaultRoot);
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
}
