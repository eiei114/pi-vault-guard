import { cwd } from "node:process";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
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
  gitErrors: string[];
  severity: VaultGuardSeverity;
  recommendedNextAction: string;
  message: string;
}

type GitCommandResult =
  | { ok: true; value: string }
  | { ok: false; message: string };

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "stderr" in error) {
    const stderr = error.stderr;
    if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
    if (Buffer.isBuffer(stderr) && stderr.toString("utf8").trim()) return stderr.toString("utf8").trim();
  }
  return error instanceof Error ? error.message : String(error);
}

function git(root: string, args: string[]): GitCommandResult {
  try {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !["GIT_DIR", "GIT_WORK_TREE"].includes(key.toUpperCase())),
    );
    return {
      ok: true,
      value: execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
      }).trimEnd(),
    };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

function isMissingUpstream(message: string): boolean {
  return /no upstream|upstream.*(not|unset|configured)|unknown revision.*@\{upstream\}|HEAD does not point to a branch/i.test(message);
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
  const requestedRoot = resolve(vaultRoot);
  const rootResult = git(requestedRoot, ["rev-parse", "--show-toplevel"]);
  if (!rootResult.ok) {
    return {
      vaultRoot: requestedRoot,
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
      gitErrors: [],
      severity: "warn",
      recommendedNextAction: "Initialize or select a git-backed vault before making guarded edits.",
      message: "vault root is not a git repository",
    };
  }

  const resolvedRoot = rootResult.value;
  const gitErrors: string[] = [];
  const branchResult = git(resolvedRoot, ["branch", "--show-current"]);
  if (!branchResult.ok) gitErrors.push(`branch: ${branchResult.message}`);
  const branch = branchResult.ok && branchResult.value ? branchResult.value : null;

  const upstreamResult = git(resolvedRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  if (!upstreamResult.ok && !isMissingUpstream(upstreamResult.message)) {
    gitErrors.push(`upstream: ${upstreamResult.message}`);
  }
  const upstream = upstreamResult.ok && upstreamResult.value ? upstreamResult.value : null;

  let counts = { ahead: 0, behind: 0 };
  if (upstream) {
    const countResult = git(resolvedRoot, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
    if (countResult.ok) counts = parseAheadBehind(countResult.value);
    else gitErrors.push(`ahead-behind: ${countResult.message}`);
  }

  // Run status from the requested root so nested vaults are scoped by `.`.
  // This avoids platform-specific pathspec handling while Git still reports
  // paths relative to the repository root.
  const statusResult = git(requestedRoot, ["status", "--porcelain=v1", "--", "."]);
  if (!statusResult.ok) gitErrors.push(`status: ${statusResult.message}`);
  const dirtyPaths = statusResult.ok ? parsePorcelainStatus(statusResult.value) : [];

  let recentUnpushedCommitSubjects: string[] = [];
  if (upstream) {
    const logResult = git(resolvedRoot, ["log", "--format=%s", "-n", "5", "@{upstream}..HEAD"]);
    if (logResult.ok) recentUnpushedCommitSubjects = logResult.value.split(/\r?\n/).filter(Boolean);
    else gitErrors.push(`log: ${logResult.message}`);
  }
  const suspiciousPaths = dirtyPaths.filter((entry) => entry.suspicious).map((entry) => entry.path);
  const severity: VaultGuardSeverity = gitErrors.length > 0
    ? "block"
    : branch === null || suspiciousPaths.length > 0 || counts.behind > 0
      ? "warn"
      : "ok";

  return {
    vaultRoot: requestedRoot,
    guardVersion: packageJson.version,
    isGitRepository: true,
    branch,
    upstream,
    ...counts,
    dirty: !statusResult.ok || dirtyPaths.length > 0,
    dirtyPaths,
    trackedDirtyPaths: dirtyPaths.filter((entry) => entry.kind === "tracked").map((entry) => entry.path),
    untrackedPaths: dirtyPaths.filter((entry) => entry.kind === "untracked").map((entry) => entry.path),
    suspiciousPaths,
    unpushedCommitCount: counts.ahead,
    recentUnpushedCommitSubjects,
    likelyObsidianGitAutoBackup: autoBackupHeuristic(recentUnpushedCommitSubjects, suspiciousPaths),
    gitErrors,
    severity,
    recommendedNextAction: gitErrors.length > 0
      ? "Resolve the reported Git status errors before making guarded edits."
      : branch === null
        ? "Create or select a branch before making guarded edits."
        : severity === "ok"
          ? "Vault is ready for guarded edits."
          : "Review the reported paths and branch state before editing.",
    message: gitErrors.length > 0
      ? `vault status is incomplete: ${gitErrors.join("; ")}`
      : dirtyPaths.length === 0 && counts.behind === 0
        ? "vault is clean"
        : "vault requires review",
  };
}
