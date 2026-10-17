import type { DirtyPath } from "./status.ts";

/** Escape terminal controls for display without changing the underlying Git path. */
export function escapePathForDisplay(path: string): string {
  return path.replace(/[\u0000-\u001f\u007f-\u009f\\]/g, (character) => {
    if (character === "\\") return "\\\\";
    return `\\u{${character.codePointAt(0)!.toString(16).padStart(4, "0")}}`;
  });
}

/** Format finish's suspicious-path warning using display-safe path text. */
export function formatSuspiciousDirtyPathWarning(paths: readonly DirtyPath[]): string | undefined {
  if (paths.length === 0) return undefined;
  return `suspicious dirty paths require review: ${paths
    .map(({ path, reasonCodes, tracking }) =>
      `${escapePathForDisplay(path)} (${reasonCodes.join("/")}; ${tracking})`,
    )
    .join(", ")}`;
}
