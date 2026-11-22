# Security policy

## Project status

IG Deals for Steam is **pre-alpha**. There has been no stable release, and no
version currently receives security support or backports.

| Version                     | Security support                       |
| --------------------------- | -------------------------------------- |
| `main` (unreleased)         | Best effort; fixes land on `main` only |
| `0.x` tags and pre-releases | None. Upgrade to the latest commit     |

Do not run the plugin if you are not comfortable with pre-alpha software.

## Reporting a vulnerability

Please report vulnerabilities **privately** through GitHub's private
vulnerability reporting:

<https://github.com/fabioudev/steam-ig-deals/security/advisories/new>

Do not open a public issue, discussion or pull request for a suspected
vulnerability. If the button is unavailable, contact the maintainer
[@fabioudev](https://github.com/fabioudev) through GitHub and ask for a private
channel.

Please include:

- what the issue is and its impact;
- the plugin version or commit, OS, Steam client and Millennium versions;
- reproduction steps or a proof of concept;
- relevant logs with personal paths and account names removed.

This is a volunteer project with no bug bounty. Reports are handled on a best
effort basis. We will confirm receipt when possible, discuss a fix and credit
you in the release notes if you want.

## Threat model

The plugin runs inside the Steam client, next to the user's account and game
library. Millennium plugins are not sandboxed from Steam: a malicious or
compromised plugin can do anything the Steam process can. The project keeps
the attack surface small rather than claiming isolation.

### Assets and trust boundaries

- **Steam session and local account data.** The plugin has no access to Steam
  credentials and must never read, log or transmit them. It only reads the
  game titles and appids visible on the pages it enhances.
- **Remote responses.** Instant Gaming's search page and Algolia responses are
  untrusted input. They are parsed defensively (`pcall`, type and size checks)
  and never executed. No `loadstring`/`eval` of remote content, no shell
  execution, no dynamic `require` of remote code.
- **Local files.** The price cache and config cache are written as JSON in
  Millennium's plugin data directory using atomic temp-file-and-rename
  writes. Corrupt files are discarded, not trusted. The cache contains
  appids, game titles, prices and timestamps — no account identifiers, no
  wishlist history beyond the keys needed to answer lookups.
- **Secrets.** The project needs no secrets, tokens or API keys. Instant
  Gaming's Algolia **search-only key is public** and origin-restricted; it is
  discovered at runtime from the public search page and cached, never
  committed to the repository. Setting the `Origin` header is what makes the
  request resemble one from the website; it is not a credential and does not
  bypass authentication.
- **Network.** The only intended destinations are `instant-gaming.com` and its
  Algolia index over HTTPS. No telemetry, analytics, accounts, cloud sync or
  arbitrary user-supplied endpoints. TLS verification is not disabled.
- **Links.** Product links open in the system browser. Instant Gaming pages
  are never loaded inside Steam's embedded Chromium, which is old and not a
  supported browsing environment.
- **Supply chain.** Dependencies are pinned in `package-lock.json`, Dependabot
  proposes grouped minor/patch updates weekly, and CI runs lint, typecheck,
  tests and the build on Ubuntu and Windows without secrets.

### Out of scope

- Vulnerabilities in Steam, Millennium, Chromium/CEF, LuaJIT, Instant Gaming
  or Algolia themselves — report those upstream.
- Users installing modified plugins, editing the cache or running the plugin
  with elevated privileges.
- Instant Gaming account, payment or checkout security; the plugin does not
  touch them.
- Price accuracy or availability. Wrong or missing prices are bugs, not
  security issues.

## Terms of service: a grey area, stated plainly

Instant Gaming has no public API. The plugin reads the same public Algolia
search index the website uses and sets an `Origin` header so that the request
is accepted. This is technically the behavior of a browser visiting the site,
but **Instant Gaming's terms of service may prohibit automated or repeated
access**, and the header manipulation can reasonably be read as circumventing
an origin restriction.

The project's position is:

- it is intended for **personal, low-volume use** — the user's own wishlist —
  with aggressive caching and sequential requests;
- it does **not** redistribute price data, resell access, or expose an API to
  third parties;
- it does **not** bypass authentication, paywalls or account restrictions.

That position is an assumption, not a legal guarantee. Terms of service and
their enforcement vary by jurisdiction and can change at any time. If you use
this project, you accept that risk. The maintainers are not lawyers, this is
not legal advice, and the software is provided under the MIT License without
warranty. If Instant Gaming or a rights holder objects, the project will be
changed or taken down; do not build a business on it.
