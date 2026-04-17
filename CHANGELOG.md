# Changelog

All notable changes to Miharbor are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions use
[semver](https://semver.org/spec/v2.0.0.html).

## [0.2.3] — 2026-04-17

### Fixed

- **`/api/config/draft` now masks secrets when falling back to live
  content, matching `/api/config/raw` — SPA no longer shows a spurious
  dirty badge on fresh login.** The `source: 'current'` branch (no
  per-user draft) previously returned the raw unmasked YAML, while
  `/api/config/raw` returned a vault-masked copy. The SPA compared the
  two strings to compute `dirtyCount`, so every secret line diverged
  and the header read "1 изменения" plus an active Apply button the
  moment the operator signed in, even without any edits. Both endpoints
  now return byte-identical masked text (memoised per live-file hash so
  repeated calls don't mint fresh `$MIHARBOR_VAULT:<uuid>` sentinels
  and break identity compare).

### Tests

- 646 → **647** tests. Added a regression test asserting that
  `/api/config/draft` (no draft) returns masked text byte-identical
  with `/api/config/raw` on a fixture carrying proxy `private-key`,
  `public-key`, `pre-shared-key`, and top-level mihomo `secret:`.

---

## [0.2.2] — 2026-04-17

Regression fix for v0.2.0: `reloadConfig()` was sending an empty request
body, which real mihomo (1.19.x) rejects with HTTP 400 "Body invalid".

### Fixed

- **`reloadConfig()` now sends a valid JSON body (`{}`)** instead of an empty
  body. Mihomo requires a valid JSON body on PUT `/configs`, even if empty.
  The empty body caused a 400 error on the live router. The `{}` body reloads
  from the currently loaded config path on disk (no need to pass path, which
  would require container context).
- **`SshTransport` now honours `MIHARBOR_CONFIG_WRITE_MODE` for remote config
  writes.** Symmetric to the v0.2.1 `LocalFsTransport` fix: the remote
  `config.yaml` is now written with mode 0o644 by default (or overridden via
  the env var), allowing hardened mihomo processes (with `CAP_DAC_OVERRIDE`
  dropped) running under a different UID to still read the config after atomic
  rename. The temporary config upload remains 0o600 (restrictive until rename).

### Tests

- 646 tests maintained. Added two tests asserting SSH config write mode defaults
  to 0o644 and that the override is honoured. Updated `FakeSshAdapter` to
  capture and expose `writeFileModes` for mode assertion in tests.

---

## [0.2.1] — 2026-04-17

Hotfix for two v0.2.0 deploy blockers discovered during the first
real-world rollout on a hardened mihomo router.

### Fixed

- **`LocalFsTransport` wrote `config.yaml` as mode 0600, breaking
  hardened mihomo readers.** Symptom: `PUT /configs?force=true` returns
  `400 permission denied` when mihomo runs as root but under a
  `CapabilityBoundingSet` without `CAP_DAC_OVERRIDE`, or as any UID that
  differs from the `bun` (UID 1000) process that Miharbor runs as inside
  the container. Root cause: the atomic tmp-write baked mode `0o600` into
  `open(2)`, and the follow-up `chmod` pinned it there. Resolution: the
  public config path (`MIHARBOR_CONFIG_PATH`) now defaults to `0o644` after
  atomic rename — group + world readable, never world-writable. Internal
  files (`.miharbor.lock`, `snapshots/*`, `.miharbor.tmp`, draft YAMLs) keep
  their restrictive owner-only modes. Override with the new
  `MIHARBOR_CONFIG_WRITE_MODE` env var (decimal — e.g. `384` for `0o600`,
  `416` for `0o640`) if you run Miharbor and mihomo under the same UID.
- **`basicAuth` middleware blocked `/api/onboarding/status`, leaving the
  SPA unable to decide "show onboarding or login".** Symptom: on a
  fresh install with `MIHARBOR_AUTH_PASS_HASH` configured but no cached
  login, the router guard probed `/api/onboarding/status`, got `401`, and
  bailed — the operator saw a blank screen instead of the onboarding
  wizard. Root cause: only `/health` was exempt from the auth gate.
  Resolution: `/api/onboarding/status` is now also exempt (exact-match).
  The endpoint is read-only and only reveals "is the mihomo config file
  missing?" + the configured path, which is not sensitive. Write paths
  (`POST /api/onboarding/seed`) and all other `/api/onboarding/*` routes
  remain behind auth.

### New environment variables

- `MIHARBOR_CONFIG_WRITE_MODE` — POSIX mode (decimal) applied to the
  public `config.yaml` after the atomic rename. Default `420` (`0o644`).

### Tests

- 638 → **644** tests. Regression tests cover both bugs plus defense
  against prefix-matching attacks on the new auth exemption
  (`/api/onboarding/statusleak`, `/api/onboarding/status/secret`).

---

## [0.2.0] — 2026-04-17

### Added — Stage 2 (full config surface)

- Visual editors for every mihomo section that Stage 1 left as stubs:
  DNS, TUN, Sniffer, top-level Profile, Rule-providers. Each with
  guardrails on critical fields, preservation of unknown keys via
  `extras` round-trip, and full EN + RU i18n.
- Raw YAML full-edit mode with parse-error guard that blocks structural
  sections (Services/DNS/TUN/…) until the YAML parses, surfacing Monaco
  markers inline — now with `monaco-yaml` live schema hints (hover +
  autocomplete) driven by the bundled mihomo JSON Schema. The YAML
  language-server worker is lazy-loaded in the same chunk as the editor,
  so the initial bundle stays well under the 600 KB gzipped budget.
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
- **BREAKING: HSTS default changed** — `Strict-Transport-Security` header
  now defaults to `max-age=31536000` **without** `includeSubDomains`. The
  `includeSubDomains` directive is aggressive for shared deployments (poisons
  TLS policy for sibling subdomains). **Upgrading from v0.1.x?** If you
  relied on `includeSubDomains`, set `MIHARBOR_HSTS_INCLUDE_SUBDOMAINS=true`
  (only if you own the entire domain).

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
- `MIHARBOR_HSTS_MAX_AGE` — configure HSTS `max-age` (seconds), or `0` to
  disable HSTS entirely.
- `MIHARBOR_HSTS_INCLUDE_SUBDOMAINS` — include `includeSubDomains` directive
  (default `false` for safer shared deployments).
- `MIHARBOR_HSTS_PRELOAD` — include `preload` directive for preload-list
  eligibility (default `false`).
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
