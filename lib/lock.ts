import { mkdirSync, openSync, closeSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cwd } from "node:process";
import packageJson from "../package.json" with { type: "json" };
import { buildVaultGuardStatus, type VaultGuardStatusResult } from "./status.ts";

export const LOCK_RELATIVE_PATH = ".pi/vault-guard/lock.json";
export const LOCK_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface VaultGuardOwner {
  type: string;
  id: string;
  name?: string;
}

export interface VaultGuardLock {
  guardVersion: string;
  issueId: string;
  issueIdentifier: string;
  sessionId: string;
  cwd: string;
  vaultRoot: string;
  purpose: string;
  createdAt: string;
  owner: VaultGuardOwner;
}

export interface VaultGuardLockSummary {
  path: string;
  state: "owned" | "other" | "stale" | "malformed";
  lock: VaultGuardLock | null;
  message: string;
}

export interface VaultGuardBeginParams {
  vaultRoot?: string;
  issueId?: string;
  issueIdentifier?: string;
  sessionId?: string;
  purpose?: string;
  owner?: VaultGuardOwner;
  allowExistingOwnedLock?: boolean;
}

export interface VaultGuardBeginResult {
  status: VaultGuardStatusResult;
  lock: VaultGuardLockSummary;
  created: boolean;
  severity: "ok" | "warn" | "block";
  message: string;
}

export function lockPath(vaultRoot: string): string {
  return join(resolve(vaultRoot), LOCK_RELATIVE_PATH);
}

function validOwner(value: unknown): value is VaultGuardOwner {
  if (!value || typeof value !== "object") return false;
  const owner = value as Record<string, unknown>;
  return typeof owner.type === "string" && owner.type.length > 0 && typeof owner.id === "string" && owner.id.length > 0 &&
    (owner.name === undefined || typeof owner.name === "string");
}

function validLock(value: unknown): value is VaultGuardLock {
  if (!value || typeof value !== "object") return false;
  const lock = value as Record<string, unknown>;
  return lock.guardVersion === packageJson.version &&
    ["issueId", "issueIdentifier", "sessionId", "cwd", "vaultRoot", "purpose", "createdAt"].every((key) =>
      typeof lock[key] === "string" && (lock[key] as string).length > 0) && validOwner(lock.owner);
}

export function readVaultGuardLock(vaultRoot: string, now = Date.now()): VaultGuardLockSummary {
  const path = lockPath(vaultRoot);
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!validLock(parsed)) return { path, state: "malformed", lock: null, message: "lock marker is malformed or missing metadata" };
    const created = Date.parse(parsed.createdAt);
    if (!Number.isFinite(created)) return { path, state: "malformed", lock: null, message: "lock marker has an invalid createdAt" };
    if (now - created > LOCK_STALE_AFTER_MS) return { path, state: "stale", lock: parsed, message: "lock marker is stale" };
    return { path, state: "other", lock: parsed, message: "active lock marker exists" };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return { path, state: "owned", lock: null, message: "no lock marker exists" };
    return { path, state: "malformed", lock: null, message: `unable to read lock marker: ${String(error)}` };
  }
}

function missingMetadata(params: VaultGuardBeginParams): string[] {
  return ["issueId", "issueIdentifier", "sessionId", "purpose", "owner"].filter((key) => {
    const value = params[key as keyof VaultGuardBeginParams];
    return key === "owner" ? !validOwner(value) : typeof value !== "string" || value.length === 0;
  });
}

export function buildVaultGuardBegin(params: VaultGuardBeginParams): VaultGuardBeginResult {
  const vaultRoot = resolve(params.vaultRoot ?? cwd());
  const status = buildVaultGuardStatus(vaultRoot);
  if (!status.isGitRepository) {
    const lock = readVaultGuardLock(vaultRoot);
    return { status, lock, created: false, severity: "block", message: "cannot begin: vault root is not a git repository" };
  }
  const missing = missingMetadata(params);
  if (missing.length > 0) {
    const lock = readVaultGuardLock(vaultRoot);
    return { status, lock, created: false, severity: "block", message: `cannot begin: missing metadata (${missing.join(", ")})` };
  }

  const existing = readVaultGuardLock(vaultRoot);
  if (existing.state === "other" && existing.lock?.sessionId === params.sessionId) {
    if (params.allowExistingOwnedLock) {
      return { status, lock: { ...existing, state: "owned", message: "active lock marker is already owned by this session" }, created: false, severity: "ok", message: "lock already owned by this session" };
    }
    return { status, lock: { ...existing, state: "owned", message: "active lock marker is already owned by this session" }, created: false, severity: "warn", message: "lock already owned by this session; set allowExistingOwnedLock to continue" };
  }
  if (existing.state === "other" || existing.state === "malformed") {
    return { status, lock: existing, created: false, severity: existing.state === "other" ? "block" : "warn", message: `cannot begin: ${existing.message}` };
  }
  if (existing.state === "stale") {
    try { unlinkSync(existing.path); } catch (error) {
      return { status, lock: existing, created: false, severity: "block", message: `cannot replace stale lock marker: ${String(error)}` };
    }
  }

  const lock: VaultGuardLock = {
    guardVersion: packageJson.version,
    issueId: params.issueId!,
    issueIdentifier: params.issueIdentifier!,
    sessionId: params.sessionId!,
    cwd: cwd(),
    vaultRoot,
    purpose: params.purpose!,
    createdAt: new Date().toISOString(),
    owner: params.owner!,
  };
  const path = lockPath(vaultRoot);
  try {
    mkdirSync(join(vaultRoot, ".pi", "vault-guard"), { recursive: true });
    const fd = openSync(path, "wx");
    try { writeFileSync(fd, `${JSON.stringify(lock, null, 2)}\n`, "utf8"); } finally { closeSync(fd); }
    return { status, lock: { path, state: "owned", lock, message: "lock marker created" }, created: true, severity: "ok", message: "lock marker created" };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      const raced = readVaultGuardLock(vaultRoot);
      return { status, lock: raced, created: false, severity: "block", message: "cannot begin: another lock was created concurrently" };
    }
    return { status, lock: { path, state: "malformed", lock: null, message: String(error) }, created: false, severity: "block", message: `cannot create lock marker: ${String(error)}` };
  }
}

export function removeVaultGuardLock(vaultRoot: string): void {
  try { unlinkSync(lockPath(vaultRoot)); } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
  }
}
