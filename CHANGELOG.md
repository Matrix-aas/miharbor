# Changelog

All notable changes to Miharbor are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions use
[semver](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-04-17

### Added — Stage 2 (full config surface)

- Visual editors for every mihomo section that Stage 1 left as stubs:
  DNS, TUN, Sniffer, top-level Profile, Rule-providers. Each with
  guardrails on critical fields, preservation of unknown keys via
  `extras` round-trip, and full EN + RU i18n.
- Raw YAML full-edit mode with parse-error guard that blocks structural
  sections (Services/DNS/TUN/…) until the YAML parses, surfacing Monaco
  markers inline.
- Tree editor for AND / OR / NOT logical rules (Services screen) with
  depth limit and serializer/parser round-trip fuzz-tested on 150
  seeded trees.
- User-defined invariants: author your own linter rules in
  `${MIHARBOR_DATA_DIR}/invariants.yaml`, CRUD UI in Settings.
- **Linter 4** — service templates suggester with Fuse.js fuzzy match
  over 78 curated services (Spotify, YouTube, Telegram, OpenAI, …)
  with RU aliases.
- **Linter 5** — auto-placement heuristic that suggests where to drop a
  new rule (ads → private → RU → services → match), with localized
  reasons and manual override.
- Actionable **suggestions** on linter Issues: eleven issue codes now
  ship with an i18n suggestion key consumed via the new
  `issue-formatter` helper.
- **SshTransport** — run Miharbor on a workstation and edit a remote
  mihomo over SSH (SFTP upload, `mihomo -t` via exec, remote `flock`
  with `mkdir` fallback). See `docs/SSH_SETUP.md`.
- CI matrix across mihomo versions 1.18.10 / 1.19.11 / 1.19.23
  (mock-mihomo driven; real-mihomo sidecar is on the v0.2.1 roadmap).
- Accessibility plugin (`eslint-plugin-vuejs-accessibility`) wired at
  warn level, plus fixes for the high-impact gaps: skip-to-main link,
  focus-trapped dialogs, form-label bindings on the heavy forms.
- Monaco editor verified to stay out of the initial bundle
  (`scripts/check-bundle-size.ts`, 600 KB gzipped budget).
- Server-side coverage gate at ≥80 % (current 91.17 %) with
  `.coverage-exclusions.json` documenting the hard-to-isolate files.

### Changed

- Sidebar nav entries for DNS / TUN / Sniffer / Profile / Providers
  flipped from `available:false` stubs to live routes.
- Extracted `GuardrailPlate` UI component (was three inline
  amber boxes in the DNS page); reused across the new pages.

### Security / Hardening — merged from v0.1.1

- **CSP + security headers middleware** (`Content-Security-Policy`,
  `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`,
  conditional `Strict-Transport-Security`, `Permissions-Policy`).
  CSP disabled only in dev (`MIHARBOR_PRODUCTION=0` /
  `MIHARBOR_CSP_DISABLED=1`). `Dockerfile` now sets
  `MIHARBOR_PRODUCTION=true` so the shipped image has CSP on by
  default.
- **Rate-limiter persistence** — Basic-Auth lockout state survives
  container restart via atomic JSON file at
  `${MIHARBOR_DATA_DIR}/rate-limit.state.json`, 1 s debounce, flush
  on SIGTERM/SIGINT, versioned (v1) format with auto-prune on load,
  corrupt-file → warn + empty state (never crash).

### Performance

- Unreachable-rule detection from O(n²) → near-linear via reverse-
  suffix trie. 2000 rules: ~430 ms → ~3 ms (~140× speedup). Output
  invariant preserved; verified against the reference implementation
  on 500 randomized inputs.
- Playwright webServer timeout bumped from 20 s to 60 s so the
  cold-start of bun imports (Elysia + ssh2 + yaml + argon2 + …)
  stops flaking the post-merge main-branch E2E run.

### New environment variables

- `MIHARBOR_CSP_DISABLED` — opt out of CSP in non-dev contexts.
- `MIHARBOR_SSH_*` — host, port, user, key path, passphrase,
  remote config / lock paths, connect timeout, keepalive interval.
  Full list in `docs/SSH_SETUP.md`.

### New dependencies (all pinned `~`)

- `fuse.js ~7.0.0` (shared, for Linter 4)
- `ssh2 ~1.15.0` + `@types/ssh2 ~1.15.0` (server, for SshTransport)
- `eslint-plugin-vuejs-accessibility ~2.4.1` (dev)

### Tests

- 379 → **610** tests (≥80 % server-side coverage enforced in CI).

---

## [0.1.0] — 2026-04-17

Initial MVP release — Docker + LocalFs transport, Services + Proxies +
Raw YAML (read-only) + History, deploy pipeline with snapshot / rollback
/ vault, linters 1/2/3/8, Basic Auth, EN localization, GHCR publication.
See the release tag for the full commit list.
