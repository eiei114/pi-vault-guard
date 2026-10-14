# pi-vault-guard

[![CI](https://github.com/eiei114/pi-vault-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/eiei114/pi-vault-guard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Pi package](https://img.shields.io/badge/pi-package-purple.svg)](https://pi.dev/packages)

> Obsidian / git-backed vault mutation guard for Pi agents — warning-first status, begin, and finish gates.

## What this is

`pi-vault-guard` helps Pi and Multica agents inspect vault safety before and after editing an Obsidian vault backed by git. Status analysis is read-only; begin creates an advisory, run-owned lock marker.

## Commands

| Command | Description |
|---|---|
| `/vault-guard:status` | Print a readable vault guard status (no arguments) |

## Tools

| Tool | Description |
|---|---|
| `vault_guard_status` | Return structured JSON with vault and lock state |
| `vault_guard_begin` | Preflight and create a run-owned lock marker |
| `vault_guard_finish` | Re-check run-owned lock and split-persist readiness |

The advisory lock is stored at `.pi/vault-guard/lock.json`, which is ignored as local runtime state. Active locks owned by another session block begin; stale or malformed markers are reported without crashing. Begin metadata includes issue ID/identifier, session ID, purpose, and owner.

Begin serializes read/stale takeover/exclusive creation with a transient
`lock.json.begin` guard. Concurrent cooperating begin calls cannot remove a new
owner's marker using an older stale snapshot. A busy/unavailable begin guard
blocks without deleting either marker. The guard is never aged out automatically:
after a crashed begin or cleanup failure, confirm that no begin writer is active
before removing the retained guard. This is an advisory local-filesystem protocol,
not protection against external programs deleting its files or older clients
that do not follow the protocol. Status remains read-only.

After guarded edits, `vault_guard_finish` checks that the supplied session still
owns the lock, re-runs vault status, and reports whether split persistence is
ready. It only removes that session's lock when `removeLock: true` and finish
is not blocked. The recommended `vault-split-commit.py --apply --push` command
is reported for handoff but is never run by the tool.

## Local install / dogfood

Load this package from your Obsidian vault checkout for dogfood:

```bash
cd path/to/your/obsidian-vault
pi install git:github.com/eiei114/pi-vault-guard -l
```

Or install from a local clone while developing:

```bash
cd C:/Users/Keisu/Projects/OSS/pi-vault-guard
npm install
pi install . -l
```

Restart Pi, then run:

```text
/vault-guard:status
```

You should see vault root, guard version, severity, and lock state. Agents can call `vault_guard_status` or `vault_guard_begin` for structured JSON.

## Development

```bash
npm install
npm run ci
pi -e .
```

## License

MIT
