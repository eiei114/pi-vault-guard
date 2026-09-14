import { cwd } from "node:process";
import packageJson from "../package.json" with { type: "json" };

export type VaultGuardSeverity = "ok" | "warn" | "block";

export interface VaultGuardStatusResult {
  vaultRoot: string;
  guardVersion: string;
  severity: VaultGuardSeverity;
  message: string;
}

const STUB_MESSAGE = "status analyzer not implemented yet";

/**
 * Build the walking-skeleton vault guard status snapshot.
 * Real git analysis starts in slice 02.
 */
export function buildVaultGuardStatus(vaultRoot: string = cwd()): VaultGuardStatusResult {
  return {
    vaultRoot,
    guardVersion: packageJson.version,
    severity: "warn",
    message: STUB_MESSAGE,
  };
}
