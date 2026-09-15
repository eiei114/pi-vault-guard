# pi-vault-guard

[![CI](https://github.com/eiei114/pi-vault-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/eiei114/pi-vault-guard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Pi package](https://img.shields.io/badge/pi-package-purple.svg)](https://pi.dev/packages)

> Obsidian / git-backed vault mutation guard for Pi agents — warning-first status, begin, and finish gates.

## What this is

`pi-vault-guard` helps Pi and Multica agents inspect vault safety before and after editing an Obsidian vault backed by git. This walking skeleton slice ships a stub status command and tool so you can load the package and confirm Vault Guard is active before git analysis lands in later slices.

## Commands

| Command | Description |
|---|---|
| `/vault-guard:status` | Print a readable stub vault guard status (no arguments) |

## Tools

| Tool | Description |
|---|---|
| `vault_guard_status` | Return structured JSON with vault root, guard version, severity, and message |

The stub status always reports `severity: "warn"` and `message: "status analyzer not implemented yet"`.

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

You should see vault root, guard version, `severity: warn`, and the stub analyzer message. Agents can call the `vault_guard_status` tool for the same payload as JSON.

## Development

```bash
npm install
npm run ci
pi -e .
```

## License

MIT
