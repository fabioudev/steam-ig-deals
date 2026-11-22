# Guidelines for AI coding agents

This repository is a public, pre-alpha Millennium plugin. Agents working here
are expected to behave like a careful contributor: small changes, verified
commands, honest documentation. These rules apply to any coding agent
(Claude Code, Codex, Copilot, Cursor, …) and to humans who find them useful.

## Read first

Before writing code, read:

1. [README.md](README.md) — what the project is and is not.
2. [docs/design.md](docs/design.md) — goals, non-goals, architecture, risks.
3. [docs/ipc-contract.md](docs/ipc-contract.md) — the RPC boundary.
4. [CONTRIBUTING.md](CONTRIBUTING.md) — setup, style, test and compliance rules.
5. [SECURITY.md](SECURITY.md) — threat model and the terms-of-service position.

If a request conflicts with the design's non-goals, say so instead of
implementing it.

## Scope

- Work only on the task you were given. Do not refactor unrelated code, rename
  files, or reformat whole directories.
- Do not modify build configuration, `package.json`, `tsconfig.json`,
  `biome.json`, `millennium.toml`, workflows or templates unless the task
  explicitly asks for it.
- Do not touch `backend/`, `frontend/`, `webview/`, `shared/`, `tests/` or
  `types/` when the task is about documentation, CI or tooling.
- When in doubt, ask. A short question is cheaper than an unwanted rewrite.

## Dependencies

- Do not add runtime or dev dependencies without discussing it first. The
  project deliberately keeps its dependency surface small.
- No new tooling that duplicates what Biome, TypeScript, Vitest or the
  built-in Lua harness already do.
- If a dependency is unavoidable, pin it in `package.json` and update
  `package-lock.json`; CI uses `npm ci`.
- Never vendor code or copy files from other projects without checking the
  license and recording attribution.

## Tests and verification

- **Tests must not touch the network.** No live requests to Instant Gaming,
  Algolia or any other host. Use fixtures in `tests/fixtures/` and inject fake
  HTTP modules or stub `fetch`.
- Tests must run without Steam, Millennium, API keys or a display server.
- Every bug fix needs a regression test. Cover `no_match`, `unavailable`,
  `error` and malformed responses, not only the happy path.
- Run `npm run check` (lint, typecheck, TypeScript tests, Lua tests) and
  `npm run build` before claiming work is done. Report the actual result; do
  not claim green from memory or from a partial run.
- CI runs on Ubuntu and Windows. Cross-platform bugs are cheap to prevent:
  use `node:path`/`node:fs` APIs, avoid shell-specific assumptions in
  TypeScript, and keep `scripts/pack.mjs` Windows-safe.
- Lua tests run under `luajit` and must not assume Millennium APIs exist.

## Type and contract synchronization

The RPC boundary is defined once and mirrored everywhere. Any change to a
request or response shape must update all of:

1. `shared/types.ts`
2. `docs/ipc-contract.md`
3. the Lua side (`cjson` serialization in `backend/`)
4. `types/millennium.d.ts` if the injected API changes
5. tests and fixtures

Cross-boundary field names are `snake_case`. The backend never throws across
the RPC boundary; it reports per-game failures.

## Secrets and data

- No secrets, API keys, tokens, cookies or credentials in code, tests,
  fixtures, logs, commit messages or issues.
- Instant Gaming's Algolia search key is public and discovered at runtime.
  Do not hardcode it in the repository.
- Never commit user data: `.millennium/`, `dist/`, cache JSON, logs, Steam
  account names, wishlist exports or `overrides.local.json`.
- Do not add telemetry, analytics or any upload of user data.
- Do not run the plugin against a real account in automated tests.

## Compliance and safety

- External links must open in the **system browser**. Never navigate Steam's
  CEF webview to Instant Gaming and never embed Instant Gaming content.
- Do not add bulk scraping, high concurrency, retry storms or anything that
  increases request volume beyond a personal wishlist with caching.
- Do not bypass authentication, paywalls or access controls.
- Do not redistribute price data or build datasets from cached prices.
- Treat all remote responses as untrusted: validate types, sizes and status
  codes; wrap parsing in `pcall`; never execute remote strings.

## Lua

- Target LuaJIT / Lua 5.1. Do not use Lua 5.2+ syntax: no bitwise operators,
  no `//`, no `goto`, use `unpack` instead of `table.unpack`, avoid `\z`.
- Keep the backend dependency-free apart from modules Millennium provides
  (`http`, `cjson`, `fs`, `logger` or their documented equivalents — confirm
  exact names against Millennium's docs before relying on them).
- Prefer pure functions for matching, cache keys and normalization so the Lua
  harness can test them without a running client.

## Git and communication

- Use [Conventional Commits](https://www.conventionalcommits.org/).
- Do not commit, push, tag or open pull requests unless you were explicitly
  asked to. Never rewrite published history.
- Do not add generated files, build output or editor junk to a commit.
- Keep documentation truthful: the project is pre-alpha, and unbuilt features
  stay marked as planned. Do not describe APIs, UI or settings that do not
  exist.

## Definition of done

- The requested change is complete and limited to the agreed scope.
- `npm run check` and `npm run build` pass (or the reason they cannot run is
  stated clearly).
- Tests cover the new behavior and do not use the network.
- Types, Lua serializers and `docs/ipc-contract.md` agree.
- Docs and CHANGELOG are updated when user-visible behavior changes.
- No secrets, user data or generated artifacts are included.
- The final report states what was changed, what was verified, and any
  remaining assumptions or risks.
