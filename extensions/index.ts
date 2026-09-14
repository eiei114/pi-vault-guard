import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { formatStatusJson, formatStatusText } from "../lib/render-status.ts";
import { buildVaultGuardStatus, type VaultGuardStatusResult } from "../lib/status.ts";

const statusParameters = Type.Object({});

export default function (pi: ExtensionAPI) {
  pi.registerCommand("vault-guard:status", {
    description: "Show vault guard status (stub walking skeleton)",
    handler: async (_args, ctx) => {
      const status = buildVaultGuardStatus();
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
      "Return a stub vault guard status snapshot (vault root, guard version, severity, message)",
    promptSnippet: "vault_guard_status: inspect vault guard readiness before editing a git-backed vault",
    promptGuidelines: [
      "Use vault_guard_status before vault mutation work to confirm Vault Guard is loaded.",
      "This walking skeleton does not analyze git state yet; treat severity warn as informational.",
    ],
    parameters: statusParameters,
    async execute(_toolCallId, _params, signal, _onUpdate, _ctx) {
      if (signal?.aborted) {
        return { content: [{ type: "text", text: "Cancelled" }], details: {} };
      }

      const status = buildVaultGuardStatus();
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
