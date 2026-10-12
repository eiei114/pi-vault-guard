import { closeSync, mkdirSync, openSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { cwd } from "node:process";
import {
  lockPath,
  readVaultGuardLock,
  removeVaultGuardLock,
  type VaultGuardLockSummary,
} from "./lock.ts";
import { buildVaultGuardStatus, type VaultGuardStatusResult } from "./status.ts";

const SPLIT_PERSIST_COMMAND = "python vault-split-commit.py --apply --push";

export interface VaultGuardFinishParams {
  vaultRoot?: string;
  sessionId: string;
  removeLock?: boolean;
}

export interface VaultGuardFinishResult {
  status: VaultGuardStatusResult;
  lock: VaultGuardLockSummary;
  splitPersistReady: boolean;
  severity: "ok" | "warn" | "block";
  blocked: boolean;
  blockers: string[];
  warnings: string[];
  lockRemoved: boolean;
  recommendedNextAction: string;
  message: string;
}

function forSession(lock: VaultGuardLockSummary, sessionId: string): VaultGuardLockSummary {
  if (lock.state === "other" && lock.lock?.sessionId === sessionId) {
    return { ...lock, state: "owned", message: "active lock marker is owned by this session" };
  }
  return lock;
}

function removeOwnedLock(vaultRoot: string, sessionId: string): {
  lock: VaultGuardLockSummary;
  removed: boolean;
  error?: string;
} {
  const guardPath = `${lockPath(vaultRoot)}.begin`;
  let guardFd: number | undefined;
  let currentLock = readVaultGuardLock(vaultRoot);
  let removed = false;
  let error: string | undefined;

  try {
    mkdirSync(join(vaultRoot, ".pi", "vault-guard"), { recursive: true });
    guardFd = openSync(guardPath, "wx");
    currentLock = readVaultGuardLock(vaultRoot);
    if (currentLock.state !== "other" || currentLock.lock?.sessionId !== sessionId) {
      error = "lock ownership changed before removal; lock was not removed";
    } else {
      removeVaultGuardLock(vaultRoot);
      removed = true;
      currentLock = readVaultGuardLock(vaultRoot);
    }
  } catch (cause) {
    error = `unable to safely remove owned lock: ${String(cause)}`;
  } finally {
    if (guardFd !== undefined) {
      try { closeSync(guardFd); } catch (cause) {
        error = [error, `unable to close lock guard: ${String(cause)}`].filter(Boolean).join("; ");
      }
      try { unlinkSync(guardPath); } catch (cause) {
        error = [error, `unable to remove lock guard: ${String(cause)}`].filter(Boolean).join("; ");
      }
    }
  }

  return { lock: currentLock, removed, error };
}

/** Re-check vault and lock state before handing changes to the split-persist workflow. */
export function buildVaultGuardFinish(params: VaultGuardFinishParams): VaultGuardFinishResult {
  const vaultRoot = resolve(params.vaultRoot ?? cwd());
  const status = buildVaultGuardStatus(vaultRoot);
  let lock = forSession(readVaultGuardLock(vaultRoot), params.sessionId);
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!status.isGitRepository) blockers.push("vault root is not a git repository");
  if (status.gitErrors.length > 0) blockers.push(...status.gitErrors.map((error) => `vault status failed: ${error}`));

  if (lock.state !== "owned") {
    if (lock.state === "other") {
      blockers.push(`active lock belongs to another session (${lock.lock?.sessionId ?? "unknown"})`);
    } else if (lock.state === "none") {
      blockers.push("no active lock is owned by this session");
    } else {
      blockers.push(`lock cannot be confirmed as owned (${lock.state}: ${lock.message})`);
    }
  }

  if (status.suspiciousPaths.length > 0) {
    warnings.push(`suspicious dirty paths require review: ${status.suspiciousPaths.join(", ")}`);
  }
  if (status.likelyObsidianGitAutoBackup) {
    warnings.push("unpushed commits or suspicious paths look like Obsidian Git auto-backup state");
  }
  if (status.branch === null) warnings.push("no current branch is available for split persistence");
  if (status.behind > 0) warnings.push(`current branch is behind its upstream by ${status.behind} commit(s)`);
  if (!status.upstream) warnings.push("current branch has no configured upstream");

  const splitPersistReady = blockers.length === 0 && warnings.length === 0 &&
    status.isGitRepository && status.gitErrors.length === 0 && status.branch !== null &&
    status.upstream !== null && status.behind === 0 && status.suspiciousPaths.length === 0 &&
    !status.likelyObsidianGitAutoBackup && lock.state === "owned";

  let lockRemoved = false;
  if (params.removeLock && blockers.length === 0) {
    const removal = removeOwnedLock(vaultRoot, params.sessionId);
    lock = forSession(removal.lock, params.sessionId);
    lockRemoved = removal.removed;
    if (removal.error) blockers.push(removal.error);
  }

  status.lock = lock;
  const blocked = blockers.length > 0;
  const severity = blocked ? "block" : warnings.length > 0 ? "warn" : "ok";
  const recommendedNextAction = blocked
    ? `Resolve the blockers before running ${SPLIT_PERSIST_COMMAND}.`
    : warnings.length > 0
      ? `Review the warnings, then decide whether to run ${SPLIT_PERSIST_COMMAND}.`
      : `Run ${SPLIT_PERSIST_COMMAND} to persist the approved vault changes.`;

  return {
    status,
    lock,
    splitPersistReady,
    severity,
    blocked,
    blockers,
    warnings,
    lockRemoved,
    recommendedNextAction,
    message: blocked
      ? `finish blocked: ${blockers.join("; ")}`
      : warnings.length > 0
        ? "finish has warnings; review them before split persistence"
        : "vault is ready for split persistence",
  };
}
