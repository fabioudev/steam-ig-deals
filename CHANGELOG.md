# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The project is pre-alpha: anything may change, including the RPC contract.

## [Unreleased]

Nothing yet.

## [0.1.0] - 2026-11-22

### Added

- Repository foundation for a Millennium plugin targeting Steam on Windows
  and Linux.
- Design document covering goals, non-goals, architecture, matching, caching
  and compliance, plus the IPC contract for `get_prices`, `clear_cache`,
  `get_status` and `refresh_config`.
- Shared TypeScript types for the RPC boundary and ambient Millennium
  declarations.
- TypeScript tooling: strict `tsconfig.json`, Biome lint/format configuration,
  Vitest setup and a dependency-free Lua test harness.
- Build wrapper (`scripts/pack.mjs`) around `starlight pack`.
- CI workflow running lint, typecheck, TypeScript tests and build on Ubuntu
  and Windows, with LuaJIT tests on Ubuntu.
- Tag-driven release workflow that builds the `.star` plugin, packages it with
  `LICENSE` and `README.md`, generates `SHA256SUMS` and publishes a GitHub
  release.
- Dependabot configuration for npm and GitHub Actions with grouped
  minor/patch updates.
- Issue forms for bug reports and feature requests, a pull request template,
  contribution, security, code-of-conduct and agent guidelines.
- README with pre-alpha status, requirements, development commands, privacy
  and disclaimer sections.

[Unreleased]: https://github.com/fabioudev/steam-ig-deals/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/fabioudev/steam-ig-deals/releases/tag/v0.1.0
