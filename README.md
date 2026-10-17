# pi-vault-guard

[![CI](https://github.com/eiei114/pi-vault-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/eiei114/pi-vault-guard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Pi package](https://img.shields.io/badge/pi-package-purple.svg)](https://pi.dev/packages)

> A warning-first mutation guard for Pi agents working in Obsidian vaults backed by Git.

## Install

After a maintainer publishes the package, install it in Pi with:

```sh
pi install npm:pi-vault-guard
```

For local dogfooding, load the extension directly from a checkout without changing vault settings:

```sh
pi -e /absolute/path/to/pi-vault-guard/extensions/index.ts
```

Alternatively, `pi install /absolute/path/to/pi-vault-guard -l` installs the local package into the current project's `.pi/settings.json`. Review that file first; do not overwrite or discard existing settings. Restart Pi after changing installed packages.

## Use

Run `/vault-guard:status` in a vault to print its current status. An optional path argument selects another vault. Status collection is read-only.

The extension also registers these tools for agents:

| Tool | Purpose |
|---|---|
| `vault_guard_status` | Return branch, dirty-path, unpushed-commit, warning, and lock details without modifying the vault. |
| `vault_guard_begin` | Re-check the vault and create a run-owned advisory lock marker. |
| `vault_guard_finish` | Verify the same run still owns its lock and report split-persistence readiness. |

Example tool arguments (use the same `vaultRoot` and `sessionId` throughout a run):

```json
{
  "vault_guard_status": { "vaultRoot": "/path/to/vault" },
  "vault_guard_begin": {
    "vaultRoot": "/path/to/vault",
    "issueId": "issue-id",
    "issueIdentifier": "DOT-123",
    "sessionId": "unique-session-id",
    "purpose": "review and edit approved notes",
    "owner": { "type": "agent", "id": "agent-id" }
  },
  "vault_guard_finish": {
    "vaultRoot": "/path/to/vault",
    "sessionId": "unique-session-id",
    "removeLock": true
  }
}
```

Call status before begin, and review the full result before editing or deciding what to persist. Finish does not commit or push: it may recommend `python vault-split-commit.py --apply --push`, but that command is only guidance and is never executed by this package. `removeLock: true` removes only this session's lock and only when finish has no blockers; warnings can still make `splitPersistReady` false.

## Reading warnings

- `ok` means no warning signals were detected; it is not an approval to persist. Review all dirty paths and branch information.
- Suspicious paths include `.pi/settings.json`, other `.pi/` runtime state, exports, generated calendars/reports, and ignored-but-tracked files. Each path includes a reason and whether Git tracks it. These are review prompts, not proof that a file is unrelated.
- Possible Obsidian Git backups are heuristic signals, not attribution. Built-in literal subject markers include `Obsidian Git`, `auto backup`, and `vault backup`; a cluster of three unpushed commits in the configured time window can also match. Additional subject markers are literal strings, not regular expressions.
- A non-Git directory, detached branch, branch behind its upstream, malformed lock, or Git status error needs attention. An active lock owned by another session blocks begin and finish; do not remove another owner's lock.
- `finish` warnings mean split persistence is not ready even when `blocked` is false. Resolve or explicitly adjudicate warnings before using any persistence workflow.

Possible Obsidian Git signals include dry-run suggestions to review the plugin's backup interval and commit-message template. Vault Guard never reads or changes Obsidian Git configuration.

## Safety and limitations

- Status only reads Git state. Begin writes an advisory lock at `.pi/vault-guard/lock.json`; finish removes it only when asked and after verifying ownership. Add `.pi/vault-guard/` to the vault's `.gitignore` if it is not already ignored.
- The lock is local filesystem coordination for cooperating runs, not a distributed lock or protection from other programs that ignore it. Inspect a stale or malformed marker before taking action; a stale marker may be replaced by begin.
- The package never commits, pushes, fetches, resets, stashes, cleans, checks out branches, deletes vault content, or edits Obsidian/plugin settings. Warnings and heuristic matches can have false positives and require human review.
- Status uses the local Git checkout and existing upstream-tracking information; it does not fetch to refresh remote state.
- The tools do not decide which files belong in a change or grant permission to persist them. Keep persistence and destructive Git operations under the maintainer's explicit control.

## Development

```sh
npm ci
npm run ci
pi -e ./extensions/index.ts
```

See [`PUBLISH_HANDOFF.md`](PUBLISH_HANDOFF.md) for the human-owned release and publication steps.
## License

MIT
