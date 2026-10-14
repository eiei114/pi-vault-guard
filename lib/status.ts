import { cwd } from "node:process";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import packageJson from "../package.json" with { type: "json" };
import { readVaultGuardLock, type VaultGuardLockSummary } from "./lock.ts";

export type VaultGuardSeverity = "ok" | "warn" | "block";
export type DirtyPathKind =
  | "tracked"
  | "untracked"
  | "pi-settings"
  | "pi-runtime"
  | "generated-or-export";
export type DirtyPathReasonCode =
  | "tracked-file"
  | "untracked"
  | "ignored-tracked"
  | "pi-settings"
  | "pi-runtime"
  | "export-file"
  | "generated-artifact"
  | "generated-calendar"
  | "generated-report";
export type DirtyPathTracking = "tracked" | "untracked";

export interface DirtyPath {
  path: string;
  status: string;
  kind: DirtyPathKind;
  tracking: DirtyPathTracking;
  reasonCodes: DirtyPathReasonCode[];
  reasons: string[];
  suspicious: boolean;
}

export interface VaultGuardStatusOptions {
  /** Additional literal subject markers. The built-in safe defaults always apply. */
  autoBackupSubjectPatterns?: readonly string[];
  /** Minutes in which three unpushed commits form a possible backup cadence. */
  autoBackupTimestampWindowMinutes?: number;
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
  suspiciousDirtyPaths: DirtyPath[];
  trackedDirtyPaths: string[];
  untrackedPaths: string[];
  suspiciousPaths: string[];
  unpushedCommitCount: number;
  recentUnpushedCommitSubjects: string[];
  likelyObsidianGitAutoBackup: boolean;
  obsidianGitAutoBackupSignals: string[];
  obsidianGitConfigGuidance: {
    mode: "dry-run";
    changesApplied: false;
    suggestions: string[];
  };
  gitErrors: string[];
  severity: VaultGuardSeverity;
  recommendedNextAction: string;
  message: string;
  lock: VaultGuardLockSummary;
}

type GitCommandResult =
  | { ok: true; value: string }
  | { ok: false; message: string; exitCode?: number };

interface UnpushedCommit {
  subject: string;
  committedAt: number | null;
}

const DEFAULT_AUTO_BACKUP_SUBJECT_PATTERNS = [
  "obsidian git",
  "obsidian-git",
  "auto backup",
  "auto-backup",
  "automatic backup",
  "automatic-backup",
  "vault backup",
];
const DEFAULT_AUTO_BACKUP_TIMESTAMP_WINDOW_MINUTES = 30;
const MAX_AUTO_BACKUP_SUBJECT_PATTERNS = 10;
const MAX_AUTO_BACKUP_SUBJECT_PATTERN_LENGTH = 80;
const OBSIDIAN_GIT_GUIDANCE = [
  "Review Obsidian Git's automatic-backup interval and commit-message template if these signals are unexpected.",
  "This is dry-run guidance only; Vault Guard does not read or change Obsidian Git plugin settings.",
];

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "stderr" in error) {
    const stderr = error.stderr;
    if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
    if (Buffer.isBuffer(stderr) && stderr.toString("utf8").trim()) return stderr.toString("utf8").trim();
  }
  return error instanceof Error ? error.message : String(error);
}

function git(root: string, args: string[], input?: string): GitCommandResult {
  try {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !["GIT_DIR", "GIT_WORK_TREE"].includes(key.toUpperCase())),
    );
    return {
      ok: true,
      value: execFileSync("git", ["-C", root, ...args], {
        encoding: "utf8",
        env,
        stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
        input,
      }).trimEnd(),
    };
  } catch (error) {
    const exitCode = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
      ? error.status
      : undefined;
    return { ok: false, message: errorMessage(error), exitCode };
  }
}

/** Parse porcelain v1 output without treating its two-character status as a path. */
export function parsePorcelainStatus(output: string, ignoredTrackedPaths: ReadonlySet<string> = new Set()): DirtyPath[] {
  const paths: DirtyPath[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line || line.startsWith("## ")) continue;
    const status = line.slice(0, 2);
    // For renames porcelain prints "old -> new"; the new path is the useful one.
    const rawPath = line.slice(3).trim();
    const renameSeparator = rawPath.lastIndexOf(" -> ");
    const path = renameSeparator >= 0 ? rawPath.slice(renameSeparator + 4) : rawPath;
    const kind = classifyDirtyPath(path, status);
    const tracking = status === "??" ? "untracked" : "tracked";
    const reasonCodes = dirtyPathReasonCodes(path, tracking, ignoredTrackedPaths.has(path));
    const reasons = reasonCodes.map((code) => DIRTY_PATH_REASONS[code]);
    paths.push({
      path,
      status,
      kind,
      tracking,
      reasonCodes,
      reasons,
      suspicious: reasonCodes.some((code) => code !== "tracked-file"),
    });
  }
  return paths;
}

export function parseAheadBehind(output: string | null): { ahead: number; behind: number } {
  const match = output?.trim().match(/^(\d+)\s+(\d+)$/);
  return match ? { ahead: Number(match[1]), behind: Number(match[2]) } : { ahead: 0, behind: 0 };
}

export function parsePorcelainBranch(output: string): {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
} {
  const header = output.split(/\r?\n/, 1)[0];
  const headerDetails = header.startsWith("## ") ? header.slice(3) : "";
  const details = headerDetails.startsWith("No commits yet on ")
    ? headerDetails.slice("No commits yet on ".length)
    : headerDetails;
  if (!details || details === "HEAD (no branch)") {
    return { branch: null, upstream: null, ahead: 0, behind: 0 };
  }

  const match = details.match(/^(.+?)(?:\.\.\.([^\s]+))?(?: \[(.*)\])?$/);
  if (!match) return { branch: null, upstream: null, ahead: 0, behind: 0 };
  const counts = match[3] ?? "";
  // A deleted upstream branch reads `[gone]`; treat it as no upstream so the
  // caller keeps the previous "missing upstream is not fatal" behavior instead
  // of failing to resolve `@{upstream}`.
  const upstream = counts === "gone" ? null : match[2] ?? null;
  return {
    branch: match[1],
    upstream,
    ahead: Number(counts.match(/ahead (\d+)/)?.[1] ?? 0),
    behind: Number(counts.match(/behind (\d+)/)?.[1] ?? 0),
  };
}

export function classifyDirtyPath(path: string, status = "  "): DirtyPathKind {
  const normalized = path.includes("\\") ? path.replaceAll("\\", "/") : path;
  if (status === "??") return "untracked";
  if (/(^|\/)\.pi\/settings\.json$/i.test(normalized)) return "pi-settings";
  if (/(^|\/)\.pi\//i.test(normalized)) return "pi-runtime";
  if (/(^|\/)(export|exports|generated|dist|build|output|outputs|calendar|calendars|report|reports)(\/|$)/i.test(normalized) ||
      /\.(pdf|html|csv|zip|tar|tgz)$/i.test(normalized)) return "generated-or-export";
  return "tracked";
}

const DIRTY_PATH_REASONS: Record<DirtyPathReasonCode, string> = {
  "tracked-file": "ordinary tracked change; no suspicious-path pattern matched",
  untracked: "untracked path; confirm it belongs in the intended vault change",
  "ignored-tracked": "tracked file matches .gitignore; ignore rules do not prevent it from being persisted",
  "pi-settings": "Pi settings are dirty; review local configuration changes separately",
  "pi-runtime": "Pi runtime state is dirty; this is local application state, not vault content",
  "export-file": "export-like path or file may be unrelated to the intended note changes",
  "generated-artifact": "generated output may be unrelated to the intended note changes",
  "generated-calendar": "generated calendar data may be unrelated to the intended note changes",
  "generated-report": "generated report data may be unrelated to the intended note changes",
};

function dirtyPathReasonCodes(path: string, tracking: DirtyPathTracking, ignoredTracked: boolean): DirtyPathReasonCode[] {
  const normalized = path.includes("\\") ? path.replaceAll("\\", "/") : path;
  const codes: DirtyPathReasonCode[] = [];
  if (/(^|\/)\.pi\/settings\.json$/i.test(normalized)) codes.push("pi-settings");
  else if (/(^|\/)\.pi\//i.test(normalized)) codes.push("pi-runtime");

  if (/(^|\/)(export|exports)(\/|$)/i.test(normalized) || /\.(pdf|html|csv|zip|tar|tgz)$/i.test(normalized)) {
    codes.push("export-file");
  }
  if (/(^|\/)(calendar|calendars)(\/|$)/i.test(normalized) || /\.(ics|ical)$/i.test(normalized) ||
      /(^|\/)(generated[-_. ])[^/]*calendar/i.test(normalized)) {
    codes.push("generated-calendar");
  }
  if (/(^|\/)(report|reports)(\/|$)/i.test(normalized) || /(^|\/)(generated[-_. ])[^/]*report/i.test(normalized) ||
      /(^|\/)(?:report|[^/]*[-_. ]report)(?:[-_. ][^/]*)?\.[^/]+$/i.test(normalized)) {
    codes.push("generated-report");
  }
  if (/(^|\/)(generated|dist|build|output|outputs)(\/|$)/i.test(normalized) &&
      !codes.includes("generated-calendar") && !codes.includes("generated-report")) {
    codes.push("generated-artifact");
  }
  if (ignoredTracked) codes.push("ignored-tracked");
  if (tracking === "untracked") codes.push("untracked");
  if (codes.length === 0) codes.push("tracked-file");
  return codes;
}

function parseUnpushedCommits(output: string): UnpushedCommit[] {
  return output.split(/\r?\n/).filter(Boolean).map((line) => {
    const separator = line.indexOf("\0");
    if (separator < 0) return { subject: line, committedAt: null };
    const timestamp = Date.parse(line.slice(separator + 1));
    return { subject: line.slice(0, separator), committedAt: Number.isNaN(timestamp) ? null : timestamp };
  });
}

function backupHeuristicSignals(
  commits: UnpushedCommit[],
  options: VaultGuardStatusOptions,
): string[] {
  const extraPatterns = (options.autoBackupSubjectPatterns ?? [])
    .slice(0, MAX_AUTO_BACKUP_SUBJECT_PATTERNS)
    .filter((pattern) => typeof pattern === "string" && pattern.trim().length > 0 && pattern.length <= MAX_AUTO_BACKUP_SUBJECT_PATTERN_LENGTH)
    .map((pattern) => pattern.trim().toLocaleLowerCase());
  const patterns = [...DEFAULT_AUTO_BACKUP_SUBJECT_PATTERNS, ...extraPatterns];
  const matchedSubject = commits.find(({ subject }) => patterns.some((pattern) => subject.toLocaleLowerCase().includes(pattern)));
  const signals: string[] = [];
  if (matchedSubject) {
    const subjectPreview = matchedSubject.subject.length > 100
      ? `${matchedSubject.subject.slice(0, 97)}…`
      : matchedSubject.subject;
    signals.push(`an unpushed commit subject matched a configured backup marker (${subjectPreview})`);
  }

  const configuredWindow = options.autoBackupTimestampWindowMinutes ?? DEFAULT_AUTO_BACKUP_TIMESTAMP_WINDOW_MINUTES;
  const windowMinutes = Number.isInteger(configuredWindow) && configuredWindow >= 5 && configuredWindow <= 120
    ? configuredWindow
    : DEFAULT_AUTO_BACKUP_TIMESTAMP_WINDOW_MINUTES;
  const timestamps = commits.map(({ committedAt }) => committedAt).filter((value): value is number => value !== null).sort((left, right) => left - right);
  const windowMs = windowMinutes * 60_000;
  const hasTimestampCluster = timestamps.some((start, index) =>
    index + 2 < timestamps.length && timestamps[index + 2] - start <= windowMs,
  );
  if (hasTimestampCluster) {
    signals.push(`three or more unpushed commits share a ${windowMinutes}-minute timestamp window`);
  }
  return signals;
}

function ignoredTrackedPaths(root: string, paths: string[]): { paths: Set<string>; error?: string } {
  if (paths.length === 0) return { paths: new Set() };
  const input = `${paths.join("\0")}\0`;
  const result = git(root, ["check-ignore", "--no-index", "--stdin", "-z"], input);
  if (!result.ok) {
    if (result.exitCode === 1) return { paths: new Set() };
    return { paths: new Set(), error: result.message };
  }
  return { paths: new Set(result.value.split("\0").filter(Boolean)) };
}

/** Collect a read-only, deterministic snapshot of a git-backed vault. */
export function buildVaultGuardStatus(vaultRoot: string = cwd(), options: VaultGuardStatusOptions = {}): VaultGuardStatusResult {
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
      suspiciousDirtyPaths: [],
      trackedDirtyPaths: [],
      untrackedPaths: [],
      suspiciousPaths: [],
      unpushedCommitCount: 0,
      recentUnpushedCommitSubjects: [],
      likelyObsidianGitAutoBackup: false,
      obsidianGitAutoBackupSignals: [],
      obsidianGitConfigGuidance: { mode: "dry-run", changesApplied: false, suggestions: OBSIDIAN_GIT_GUIDANCE },
      gitErrors: [],
      severity: "warn",
      recommendedNextAction: "Initialize or select a git-backed vault before making guarded edits.",
      message: "vault root is not a git repository",
      lock: readVaultGuardLock(requestedRoot),
    };
  }

  const resolvedRoot = rootResult.value;
  const gitErrors: string[] = [];
  // Porcelain branch headers include branch, upstream, and ahead/behind counts.
  // Reading them with status avoids three additional Git process launches.
  const statusResult = git(requestedRoot, ["status", "--porcelain=v1", "--branch", "--untracked-files=all", "--", "."]);
  if (!statusResult.ok) gitErrors.push(`status: ${statusResult.message}`);
  const branchInfo = statusResult.ok
    ? parsePorcelainBranch(statusResult.value)
    : { branch: null, upstream: null, ahead: 0, behind: 0 };
  const { branch, upstream } = branchInfo;
  const counts = { ahead: branchInfo.ahead, behind: branchInfo.behind };
  const rawDirtyPaths = statusResult.ok ? parsePorcelainStatus(statusResult.value) : [];
  const ignored = ignoredTrackedPaths(requestedRoot, rawDirtyPaths
    .filter(({ tracking }) => tracking === "tracked")
    .map(({ path }) => path));
  if (ignored.error) gitErrors.push(`check-ignore: ${ignored.error}`);
  const dirtyPaths = statusResult.ok ? parsePorcelainStatus(statusResult.value, ignored.paths) : [];
  const trackedDirtyPaths: string[] = [];
  const untrackedPaths: string[] = [];
  const suspiciousPaths: string[] = [];
  for (const entry of dirtyPaths) {
    if (entry.tracking === "tracked") trackedDirtyPaths.push(entry.path);
    if (entry.tracking === "untracked") untrackedPaths.push(entry.path);
    if (entry.suspicious) suspiciousPaths.push(entry.path);
  }

  let unpushedCommits: UnpushedCommit[] = [];
  if (upstream) {
    const logResult = git(resolvedRoot, ["log", "--format=%s%x00%cI", "-n", "20", "@{upstream}..HEAD"]);
    if (logResult.ok) unpushedCommits = parseUnpushedCommits(logResult.value);
    else gitErrors.push(`log: ${logResult.message}`);
  }
  const recentUnpushedCommitSubjects = unpushedCommits.slice(0, 5).map(({ subject }) => subject);
  const obsidianGitAutoBackupSignals = backupHeuristicSignals(unpushedCommits, options);
  const likelyObsidianGitAutoBackup = obsidianGitAutoBackupSignals.length > 0;
  const severity: VaultGuardSeverity = gitErrors.length > 0
    ? "block"
    : branch === null || suspiciousPaths.length > 0 || counts.behind > 0 || likelyObsidianGitAutoBackup
      ? "warn"
      : "ok";
  const suspiciousDirtyPaths = dirtyPaths.filter(({ suspicious }) => suspicious);

  return {
    vaultRoot: requestedRoot,
    guardVersion: packageJson.version,
    isGitRepository: true,
    branch,
    upstream,
    ...counts,
    dirty: !statusResult.ok || dirtyPaths.length > 0,
    dirtyPaths,
    suspiciousDirtyPaths,
    trackedDirtyPaths,
    untrackedPaths,
    suspiciousPaths,
    unpushedCommitCount: counts.ahead,
    recentUnpushedCommitSubjects,
    likelyObsidianGitAutoBackup,
    obsidianGitAutoBackupSignals,
    obsidianGitConfigGuidance: { mode: "dry-run", changesApplied: false, suggestions: OBSIDIAN_GIT_GUIDANCE },
    gitErrors,
    severity,
    recommendedNextAction: gitErrors.length > 0
      ? "Resolve the reported Git status errors before making guarded edits."
      : likelyObsidianGitAutoBackup
        ? "Review the possible Obsidian Git auto-backup signals and risky paths; verify before persisting."
        : suspiciousPaths.length > 0
          ? "Review the listed risky paths and confirm they belong in the intended vault changes."
          : branch === null
          ? "Create or select a branch before making guarded edits."
          : severity === "ok"
            ? "Vault is ready for guarded edits."
            : "Review the reported paths and branch state before editing.",
    message: gitErrors.length > 0
      ? `vault status is incomplete: ${gitErrors.join("; ")}`
      : likelyObsidianGitAutoBackup
        ? "unpushed commits resemble possible Obsidian Git auto-backup activity (heuristic; verify before acting)"
        : dirtyPaths.length === 0 && counts.behind === 0
          ? "vault is clean"
          : "vault requires review",
    lock: readVaultGuardLock(requestedRoot),
  };
}
