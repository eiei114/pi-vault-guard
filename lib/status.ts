import { cwd } from "node:process";
import { execFileSync } from "node:child_process";
import packageJson from "../package.json" with { type: "json" };

export type VaultGuardSeverity = "ok" | "warn" | "block";
export type DirtyPathKind =
  | "tracked"
  | "untracked"
  | "pi-settings"
  | "pi-runtime"
  | "generated-or-export";

export interface DirtyPath {
  path: string;
  status: string;
  kind: DirtyPathKind;
  suspicious: boolean;
}

export interface VaultGuardStatusResult {
  vaultRoot: string;
  guardVersion: string;
  isGitRepository: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  dirty: boolean;
  dirtyPaths: DirtyPath[];
  trackedDirtyPaths: string[];
  untrackedPaths: string[];
  suspiciousPaths: string[];
  unpushedCommitCount: number;
  recentUnpushedCommitSubjects: string[];
  likelyObsidianGitAutoBackup: boolean;
  severity: VaultGuardSeverity;
  recommendedNextAction: string;
  message: string;
}

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/** Parse porcelain v1 output without treating its two-character status as a path. */
export function parsePorcelainStatus(output: string): DirtyPath[] {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2);
      // For renames porcelain prints "old -> new"; the new path is the useful one.
      const rawPath = line.slice(3).trim();
      const path = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1)! : rawPath;
      const kind = classifyDirtyPath(path, status);
      return { path, status, kind, suspicious: kind !== "tracked" };
    });
}

export function parseAheadBehind(output: string | null): { ahead: number; behind: number } {
  const match = output?.trim().match(/^(\d+)\s+(\d+)$/);
  return match ? { ahead: Number(match[1]), behind: Number(match[2]) } : { ahead: 0, behind: 0 };
}

export function classifyDirtyPath(path: string, status = "  "): DirtyPathKind {
  const normalized = path.replaceAll("\\", "/");
  if (status === "??") return "untracked";
  if (normalized === ".pi/settings.json") return "pi-settings";
  if (normalized.startsWith(".pi/")) return "pi-runtime";
  if (/(^|\/)(export|exports|generated|dist|build|output|outputs)(\/|$)/i.test(normalized) ||
      /\.(pdf|html|csv|zip|tar|tgz)$/i.test(normalized)) return "generated-or-export";
  return "tracked";
}

function autoBackupHeuristic(subjects: string[], paths: string[]): boolean {
  return [...subjects, ...paths].some((value) =>
    /(obsidian[ -]?git|auto[ -]?backup|automatic[ -]?backup)/i.test(value),
  );
}

/** Collect a read-only, deterministic snapshot of a git-backed vault. */
export function buildVaultGuardStatus(vaultRoot: string = cwd()): VaultGuardStatusResult {
  const resolvedRoot = git(vaultRoot, ["rev-parse", "--show-toplevel"]);
  if (!resolvedRoot) {
    return {
      vaultRoot,
      guardVersion: packageJson.version,
      isGitRepository: false,
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      dirty: false,
      dirtyPaths: [],
      trackedDirtyPaths: [],
      untrackedPaths: [],
      suspiciousPaths: [],
      unpushedCommitCount: 0,
      recentUnpushedCommitSubjects: [],
      likelyObsidianGitAutoBackup: false,
      severity: "warn",
      recommendedNextAction: "Initialize or select a git-backed vault before making guarded edits.",
      message: "vault root is not a git repository",
    };
  }

  const branch = git(resolvedRoot, ["branch", "--show-current"]) || null;
  const upstream = git(resolvedRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]) || null;
  const counts = parseAheadBehind(upstream ? git(resolvedRoot, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]) : null);
  const dirtyPaths = parsePorcelainStatus(git(resolvedRoot, ["status", "--porcelain=v1"]) ?? "");
  const recentUnpushedCommitSubjects = upstream
    ? (git(resolvedRoot, ["log", "--format=%s", "-n", "5", "@{upstream}..HEAD"]) ?? "").split(/\r?\n/).filter(Boolean)
    : [];
  const suspiciousPaths = dirtyPaths.filter((entry) => entry.suspicious).map((entry) => entry.path);
  const severity: VaultGuardSeverity = suspiciousPaths.length > 0 || counts.behind > 0 ? "warn" : "ok";

  return {
    vaultRoot: resolvedRoot,
    guardVersion: packageJson.version,
    isGitRepository: true,
    branch,
    upstream,
    ...counts,
    dirty: dirtyPaths.length > 0,
    dirtyPaths,
    trackedDirtyPaths: dirtyPaths.filter((entry) => entry.kind === "tracked").map((entry) => entry.path),
    untrackedPaths: dirtyPaths.filter((entry) => entry.kind === "untracked").map((entry) => entry.path),
    suspiciousPaths,
    unpushedCommitCount: recentUnpushedCommitSubjects.length,
    recentUnpushedCommitSubjects,
    likelyObsidianGitAutoBackup: autoBackupHeuristic(recentUnpushedCommitSubjects, suspiciousPaths),
    severity,
    recommendedNextAction: severity === "ok"
      ? "Vault is ready for guarded edits."
      : "Review the reported paths and branch state before editing.",
    message: dirtyPaths.length === 0 && counts.behind === 0 ? "vault is clean" : "vault requires review",
  };
}
