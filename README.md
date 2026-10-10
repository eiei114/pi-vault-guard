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

The advisory lock is stored at `.pi/vault-guard/lock.json`, which is ignored as local runtime state. Active locks owned by another session block begin; stale or malformed markers are reported without crashing. Begin metadata includes issue ID/identifier, session ID, purpose, and owner.

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
