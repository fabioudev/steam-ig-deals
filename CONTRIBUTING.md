# Contributing to IG Deals for Steam

Thanks for your interest. This project is **pre-alpha**: the foundation exists,
but major features are still being built. Small, focused contributions are
much easier to review than large ones.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- For anything beyond a typo or a small fix, open an issue first so the design
  can be discussed. Read [docs/design.md](docs/design.md) and
  [docs/ipc-contract.md](docs/ipc-contract.md).
- Security issues go through [SECURITY.md](SECURITY.md), never a public issue.
- Check the design's non-goals before proposing features. Buying automation,
  other key resellers and loading Instant Gaming inside Steam's embedded
  browser are out of scope for v1.

## Prerequisites

- **Node.js >= 20** and npm (the CI uses Node 24).
- **Git**.
- **LuaJIT** for the Lua tests (`npm run test:lua`). On Debian/Ubuntu:
  `sudo apt-get install luajit`. On Arch: `sudo pacman -S luajit`.
  On Windows, use a LuaJIT build available on your `PATH`.
- **Steam + Millennium** only if you want to run the plugin with
  `npm run dev`. The lint, typecheck, test and build commands work without
  Steam and without network access.

Linux users need Millennium installed through the AUR package. Flatpak and
Snap builds of Steam are not supported by Millennium, so they are not
supported by this plugin either.

## Development setup

```sh
git clone https://github.com/fabioudev/steam-ig-deals.git
cd steam-ig-deals
npm install
```

Commands:

| Command                          | What it does                                                                   | Needs Steam? |
| -------------------------------- | ------------------------------------------------------------------------------ | ------------ |
| `npm run dev`                    | Build, install into the detected Millennium installation and watch (Starlight) | Yes          |
| `npm run check`                  | `lint` + `typecheck` + TypeScript tests + Lua tests                            | No           |
| `npm run lint`                   | Biome lint and format check                                                    | No           |
| `npm run lint:fix`               | Apply safe Biome fixes                                                         | No           |
| `npm run format`                 | Format with Biome                                                              | No           |
| `npm run typecheck`              | `tsc --noEmit`                                                                 | No           |
| `npm test`                       | Vitest, single run                                                             | No           |
| `npm run test:watch`             | Vitest in watch mode                                                           | No           |
| `npm run test:lua`               | Dependency-free Lua harness through LuaJIT                                     | No           |
| `npm run build` / `npm run pack` | Pack the plugin into `dist/` via `scripts/pack.mjs`                            | No           |

`npm run dev` installs the plugin into the Millennium installation Starlight
finds and reloads the Steam UI when configured. Restart Steam if Millennium
asks you to.

## Project layout

```
backend/    Lua backend: RPC entry points, HTTP, Algolia, matching, cache
frontend/   Millennium settings page (React/TypeScript)
webview/    Steam UI preload: wishlist and store-page DOM injection
shared/     TypeScript types and display helpers shared by frontend and webview
tests/      Vitest tests (tests/**/*.test.ts), fixtures/ and the Lua harness
types/      Ambient TypeScript declarations (millennium.d.ts)
docs/       Design, IPC contract and assets
scripts/    Build wrapper (pack.mjs)
resources/  Files embedded into the plugin
```

The `backend/`, `frontend/` and `webview/` directories are populated as the
milestones in [docs/design.md](docs/design.md) land.

## Branches and commits

- Branch from `main`. Use a short descriptive prefix: `feat/…`, `fix/…`,
  `docs/…`, `test/…`, `chore/…`.
- Use [Conventional Commits](https://www.conventionalcommits.org/):
  `feat(webview): render wishlist badges`, `fix(cache): ignore corrupt JSON`,
  `docs: document the IPC contract`.
- Keep commits reviewable. Do not mix unrelated formatting with behavior
  changes.
- Do not force-push or rewrite a branch under review without telling the
  maintainer.

## Pull requests

1. Open an issue or comment on an existing one for non-trivial work.
2. Keep the change focused; split unrelated refactors into separate PRs.
3. Run `npm run check` and `npm run build` before pushing. CI runs both on
   Ubuntu and Windows, plus Lua tests on Ubuntu.
4. Describe manual testing in the PR — especially anything that touches the
   Steam UI, since CI cannot click through Steam.
5. Fill out the compliance checklist in the PR template.
6. A maintainer will review. Expect questions about scope and about matching
   and caching behavior; those are the risky parts of the design.

CI must stay green. A red matrix needs a fix or an explicit reason in the PR;
we do not merge with skipped tests.

## Code style

- **Biome** (2 spaces, single quotes, semicolons, trailing commas, 100 columns)
  is the source of truth. Run `npm run lint:fix` and `npm run format`.
- TypeScript is `strict` with `noUncheckedIndexedAccess`,
  `noUnusedLocals`/`noUnusedParameters` and `noImplicitReturns`. Do not weaken
  `tsconfig.json` to make a change compile.
- Prefer small modules with pure, testable functions. Keep DOM access in the
  webview and RPC plumbing at the edges.
- Do not add runtime dependencies without discussing it first. Dev
  dependencies need a justification too; the dependency surface is kept small
  on purpose.

### RPC types

Field names that cross the RPC boundary are `snake_case` so Lua and TypeScript
do not need a mapping layer. When you change a shape, update **all** of:

1. `shared/types.ts`
2. `docs/ipc-contract.md`
3. the Lua serialization in `backend/` (via `cjson`)
4. `types/millennium.d.ts` if the injected API changes
5. tests and fixtures

The backend must never throw across the RPC boundary; report failures per game
as `{ status = "error" }`.

### Lua

- Millennium runs **LuaJIT**, which is Lua 5.1 plus extensions. Write Lua 5.1
  compatible code: no bitwise operators, no `//` integer division, no `goto`,
  use `unpack` rather than `table.unpack`, and avoid `\z` string escapes.
- Use `cjson` for serialization and the Millennium HTTP API for requests.
- Treat every response from Instant Gaming and Algolia as untrusted: check
  status codes, wrap parsing in `pcall`, validate types and sizes.
- Keep requests sequential and cached. Never add retry storms or parallelism
  that could hammer Instant Gaming.

### Tests

- TypeScript tests use Vitest. The environment is Node (`vitest.config.ts`);
  use `happy-dom` for DOM work.
- **No live network in tests.** No requests to Instant Gaming, Algolia or any
  other host. Use fixtures in `tests/fixtures/` and inject fake HTTP modules or
  stub `fetch`.
- Tests must pass without Steam, Millennium, API keys or a display server.
- Lua tests are dependency-free and run with `luajit tests/lua/run.lua`; do not
  assume Millennium APIs are present. Pass fake modules in from the harness.
- Add a regression test with every bug fix, and cover error/empty/malformed
  responses — not only the happy path.

## Compliance rules

These are not optional:

- **Personal use, low volume.** The plugin is for a user's own wishlist. Do
  not add bulk enumeration, high concurrency or anything that resembles
  scraping at scale.
- **Cache.** Every lookup goes through the price cache with a TTL; do not add
  per-render or per-keystroke requests.
- **No redistribution of price data.** Do not commit cached prices, build
  price datasets, expose an API for third parties or bundle Instant Gaming
  content.
- **No Instant Gaming pages inside Steam's CEF.** The embedded Chromium is
  too old and loading the site there is out of scope. Open product links in
  the system browser.
- **No secrets or user data in the repository.** The Algolia search key is a
  public, origin-restricted search-only key discovered at runtime; do not
  hardcode other credentials. Never commit `.millennium/`, `dist/`, caches,
  `overrides.local.json`, wishlist exports or logs.
- Read [SECURITY.md](SECURITY.md) for the threat model and the plainly stated
  terms-of-service grey area.

## License

By contributing you agree that your contribution is licensed under the
[MIT License](LICENSE).
