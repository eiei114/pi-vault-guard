# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.2] - 2026-09-30

### Changed

- Update `@earendil-works/pi-*` dependencies to `0.99.1`.

## [Unreleased]

### Added

- Add reason-coded dirty-path warnings, tracked/untracked context, and dry-run Obsidian Git guidance.
- Flag possible Obsidian Git auto-backups using configurable literal subject markers and commit timestamp clusters.
- Add `vault_guard_finish` to verify run-owned lock and split-persist readiness before handoff.

### Changed

- Require an explicit, version-confirmed manual release dispatch on `main` before creating a release or triggering npm publish.

### Fixed

- Parse NUL-delimited Git status paths so ignored tracked files with non-ASCII names and rename destinations are classified correctly.

## [0.1.1] - 2026-10-16

### Changed

- Pin Pi SDK development and test dependencies to 1.2.0 while preserving public peer ranges.

## [0.0.3] - 2026-10-13

### Changed

- Reduce temporary allocations when aggregating dirty-path summaries.

## [0.0.1] - 2026-09-15

### Added

- Walking skeleton `/vault-guard:status` command
- Stub `vault_guard_status` tool with TypeBox schema
- Shared status rendering module for command and tool output
- README local install / dogfood instructions
