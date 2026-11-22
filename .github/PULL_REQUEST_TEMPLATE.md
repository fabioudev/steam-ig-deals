# Pull request

## Summary

<!-- What does this change, and why? Link related issues. -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor or cleanup
- [ ] Documentation or tooling
- [ ] Other (describe above)

## Testing

<!--
How was this verified? Paste relevant command output or describe manual
checks. For UI changes, say which Steam pages you tested and on which OS.
-->

## Checklist

- [ ] I ran `npm run check` (lint, typecheck, TypeScript tests, Lua tests) locally.
- [ ] `npm run lint` and `npm run typecheck` pass with no new warnings.
- [ ] Tests do not reach the live network; network behavior is covered with fixtures or mocks.
- [ ] Changes to the RPC boundary keep `shared/types.ts`, `docs/ipc-contract.md`, the Lua serializers and `types/millennium.d.ts` in sync.
- [ ] Documentation is updated if behavior, setup or configuration changed.
- [ ] Commits follow [Conventional Commits](https://www.conventionalcommits.org/).

## Compliance

- [ ] I have read [SECURITY.md](../SECURITY.md), including the terms-of-service section.
- [ ] This change does not redistribute Instant Gaming price data, bundle or proxy Instant Gaming content, or load Instant Gaming pages inside Steam's CEF.
- [ ] This change keeps requests rate-limited and cached; it does not add scraping at scale or bypass authentication.
- [ ] No secrets, tokens, personal data, local caches or logs are included.
