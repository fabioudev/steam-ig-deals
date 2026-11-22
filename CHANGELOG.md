# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The project is pre-alpha: anything may change, including the RPC contract.

## [Unreleased]

### Changed

- Disabled the IG wishlist sorting in the shipped build: reordering Steam's
  virtualized list from outside React was unstable while scrolling. Wishlist
  badges are unaffected; a separate deals view is planned.

### Added

- Wishlist badges anchored above Steam's price element, right-aligned, using
  Instant Gaming's orange palette with the official logo (loaded from
  instant-gaming.com), the gross price and a discount chip. A green accent
  marks products that are cheaper than Steam.
- Gross price display: Instant Gaming's net prices are converted with the
  configured country's standard VAT rate (`shared/vat.ts`). The badge shows the
  gross amount without a separate tax note.
- Store app pages show the same badge above the purchase box.
- Pulsing loading skeletons occupy the badge slot while Instant Gaming prices
  are being fetched.
- The last sort keys are cached, so an IG-sorted list starts in the right order
  instead of reordering again when the prices arrive.
- Sorting uses CSS flex `order` instead of moving React-managed cards, avoiding
  the brief list flash/remount caused by DOM reordering.
- Wishlist badges render in a fixed overlay outside Steam's React root and are
  positioned above the add-to-cart button (falling back to the price element),
  repositioned on scroll/resize, so card re-renders can no longer remove them
  and make them flash away.
- The overlay is placed inside the wishlist's scroll container and uses content
  coordinates, so Chromium's compositor scrolls the badges with the cards
  instead of JavaScript updates lagging behind.
- If React re-renders the scroller and removes the overlay, it is re-attached
  with its badges instead of disappearing.
- Sort switching is more stable: the IG order is re-applied as soon as React
  mounts new cards, disconnected cards are skipped during positioning, and the
  overlay refreshes/reattaches after the list re-renders.
- Cards loaded by infinite scroll are appended after the already placed ones
  instead of re-sorting the visible list on every scroll; selecting "Rabatt
  inkl. IG" again re-sorts the loaded set.
- The sort order is stored as appid ranks and applied through a generated
  stylesheet keyed by `data-igdeals-appid` attributes, so React rewriting card
  inline styles can no longer drop the order and make the list jump while
  scrolling.
- Overlay entries are pruned when an appid leaves the collected wishlist and
  replaced when React recycles a card element for another game, so badges and
  prices can no longer stick to the wrong card.
- Query/hash-only URL updates (sorting, filters) no longer count as navigation;
  they used to clear and rebuild all badges.
- The sort popup option now appears together with the menu, and the mutation
  observer ignores plugin-owned nodes and pauses while the popup is open,
  removing the slight dropdown flicker.
- "Rabatt inkl. IG" entry inside Steam's sort popup, reordering wishlist cards
  by the best discount across Steam and Instant Gaming. While active, the sort
  button label shows the IG choice instead of the stale native sort; picking a
  native Steam option turns IG sorting off.
- Development diagnostics for card counts and price comparisons, disabled by
  default.

### Changed

- Badge price comparison uses the gross Instant Gaming price against Steam's
  gross price.

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
