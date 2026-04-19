# Changelog

All notable changes to Miharbor are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions use
[semver](https://semver.org/spec/v2.0.0.html).

## [0.2.9] — 2026-04-19

Rolls up the `setProfileConfig` quote-preservation fix on top of 0.2.8
(so a single-field edit no longer reformats neighbouring string
scalars). Image `ghcr.io/matrix-aas/miharbor:0.2.8` is usable in
production, but `:0.2.9` is the recommended one — it's the first
release where `/api/config/draft/diff` tells the whole truth after an
arbitrary sequence of UI toggles.

## [0.2.8] — 2026-04-19

Fixes the scariest problem in v0.2.6: saving an unchanged draft (or
toggling a boolean and back) showed a large, alarming diff full of
quote-style flips, folded URLs and map-key reordering. Operators
rightly hesitated to press Apply, because it was impossible to tell
whether a cosmetic re-format or a real change was queued up. The round
trip is now canonical on both sides of `/api/config/draft/diff`, AND
unchanged scalars keep their original quote style so edits produce
one-line diffs instead of whole-section rewrites.

### Fixed

- **Canonicalization symmetry across server / web.** The `DUMP_OPTS`
  yaml@2 serializer options — `lineWidth: 0`, `defaultStringType: 'PLAIN'`,
  etc. — now live in `miharbor-shared`, imported from every YAML write
  path: the server's `canonicalize` / masked-live / draft-migrate paths,
  the deploy pipeline, AND the web's `serializeDraft`. Previously only
  the server's canonicalize+pipeline used them; masked-live used
  yaml@2 defaults (lineWidth 80, preserved quote styles) while the web
  mutator also used defaults, so the two sides emitted the same
  semantic YAML in different bytes. Result: unchanged round-trip is
  now byte-identical, and `/api/config/draft/diff` returns `''` with
  `added=0/removed=0` instead of a formatting delta.
- **Vault sentinels no longer inherit quote style from the source
  scalar.** `walkSecrets` now resets `valNode.type = Scalar.PLAIN`
  when replacing a scalar with a `$MIHARBOR_VAULT:<uuid>` marker. A
  config containing `secret: "plain value"` (double-quoted) used to
  mask as `secret: "$MIHARBOR_VAULT:<uuid>"`, then re-serialize on the
  web side as plain — producing spurious `/draft/diff` noise on every
  secret-bearing field. Sentinels are stable plain literals now, and
  the canonical serializer is free to emit them unquoted on both sides.
- **`/api/config/draft/diff` returns `patch: ""` for identical
  buffers.** `createTwoFilesPatch` always emits the `--- / +++` header
  even when the two inputs match; the route now collapses the
  zero-change case so the PendingChangesDialog shows "No changes"
  instead of a phantom empty diff pane.
- **`setProfileConfig` no longer re-mints every managed scalar on each
  edit.** Before, a single `allow-lan` toggle ran every profile field
  through `doc.createNode()`, dropping the operator's original quote
  style (`external-ui-url: "..."` → `external-ui-url: ...`) on values
  that hadn't actually changed. The mutator now skips
  `rootMap.set(k, …)` when the existing scalar is value-equivalent to
  the incoming value — only genuinely edited scalars get replaced.
  Regression test in `apps/web/tests/profile.spec.ts` round-trips
  single- and double-quoted neighbours of a toggled boolean.

### Rolled up from v0.2.7

- **SSE heartbeat.** Both `/api/health/stream` and
  `/api/deploy/stream` now flush an 8-second keep-alive comment so
  Bun.serve's 10-second `idleTimeout` doesn't reap quiescent streams
  and surface `ERR_HTTP2_PROTOCOL_ERROR` in the browser console. The
  subscription helper additionally clears its interval on cancel to
  avoid a per-disconnect setInterval leak.

## [0.2.7] — 2026-04-19

Post-deploy fix-up for v0.2.6: the HTTP/2 header removal in the SSE
helpers was necessary but not sufficient — Bun.serve's default 10-second
`idleTimeout` was independently reaping both `/api/health/stream` and
`/api/deploy/stream` between events, surfacing the same
`ERR_HTTP2_PROTOCOL_ERROR` in the browser. Both helpers now emit an
8-second heartbeat comment (discarded by the EventSource parser) so the
socket stays active across quiescent periods; the subscription helper
additionally clears its heartbeat interval on cancel so we don't leak a
timer per client disconnect.

## [0.2.6] — 2026-04-19

Hot-fixes for six paper-cuts surfaced during v0.2.5 acceptance testing,
plus the RULE-SET selector follow-up to the v0.2.5 geo catalog work.

### Added

- **RULE-SET selector in the RuleEditor.** New
  `GET /api/catalog/rule-providers` reads the live mihomo config and
  returns the names declared under `profile.rule-providers`. The web
  `RuleSetCombobox` surfaces them as a type-ahead when the rule type is
  `RULE-SET`; free-form input is still accepted (fallback when the
  catalog is unavailable or the operator references a provider that is
  not yet declared). Rule-providers live under the document root in
  mihomo's config, not under `profile:` — the response's `source` tag
  reflects that (`source: "rule-providers"`). Store loader is
  independent from the geo catalog so a RULE-SET-only edit doesn't
  fire a geo fetch.
- `isVaultSentinel` / `isAnyMiharborSentinel` predicates in
  `miharbor-shared` — form-side unified recognition of both the fixed
  view-scope sentinels (`META_SECRET_SENTINEL`,
  `WIREGUARD_PRIVATE_KEY_SENTINEL`, `WIREGUARD_PRE_SHARED_KEY_SENTINEL`)
  and the per-value vault sentinels (`$MIHARBOR_VAULT:<uuid>`).

### Fixed

- **Forms recognise per-value vault sentinels.** `WireGuardForm`
  (`private-key`, `pre-shared-key`) and `ProfileForm` (`secret`) now
  short-circuit validation, disable the reveal-eye, and round-trip
  unchanged when the initial value is a `$MIHARBOR_VAULT:<uuid>`
  placeholder — previously they saw the sentinel verbatim, tripped
  "Invalid WireGuard key" for keys and let the operator type over the
  sentinel with fear of destroying the real value on save. Affects any
  form seeded from the draft endpoint (`parseDraft` path); the existing
  view-scope sentinel path was already correct.
- **`/api/health/stream` no longer kills itself with
  `ERR_HTTP2_PROTOCOL_ERROR`.** Two underlying bugs: (1) the SSE
  response set `connection: 'keep-alive'`, which HTTP/2 forbids
  (RFC 7540 §8.1.2.2) — the reverse proxy fronting the deployment was
  closing the stream the moment it saw the forbidden header; (2) with
  the header removed the stream survived connection establishment but
  Bun.serve's 10-second idleTimeout still reaped it between health
  events, producing the same browser-visible error on the subsequent
  EventSource reconnect. Both helpers (`sseStreamFromEvents` and
  `sseStreamFromSubscription`) now flush an SSE heartbeat comment
  (`: ping\n\n`, discarded by EventSource) every 8s so the socket stays
  above the idleTimeout window; `sseStreamFromSubscription` additionally
  clears its heartbeat interval on cancel to avoid a per-disconnect
  setInterval leak.
- **Snapshot diff renders one line per line again.** The local
  `.d2h-code-line` override set `white-space: pre`, which caused
  diff2html's `<span class="d2h-code-line-prefix">+</span>` and
  `<span class="d2h-code-line-ctn">…</span>` to wrap across three
  visual rows apiece (the literal `\n` between the two spans in the
  emitted HTML was preserved). Switched the wrapper to `nowrap` and
  moved `pre` onto `.d2h-code-line-ctn` only (the content span), so
  indentation inside a line is still preserved but the prefix sits on
  the same row. Same fix applied to `PendingChangesDialog` so pending
  diffs render cleanly too.
- **Config-version badge hides instead of showing `Конфиг v—`.** When
  neither `meta.version` nor `meta.revision` is populated (typical
  mihomo configs declare neither on the top level), the Header omits
  the badge entirely. When either is set, the badge renders with that
  value.

### Changed

- **Autofill hygiene on forms with password fields.** `WireGuardForm`
  gains `autocomplete="off"` on the `<form>` plus
  `autocomplete="new-password"` on both `private-key` and
  `pre-shared-key` inputs. `ProfileForm` is now wrapped in a dummy
  `<form autocomplete="off" @submit.prevent>` and the `secret` input
  uses `autocomplete="new-password"`. Silences Chrome's DOM warnings
  about loose `type="password"` fields and multiple-forms heuristics;
  no functional change (Profile.vue still owns persistence via emitted
  patches, not form submission).

## [0.2.5] — 2026-04-19

Three UX fixes addressing user-reported paper-cuts on the Services and
Proxies screens plus the Header's dirty-state indicator.

### Added

- **GEOSITE / GEOIP / SRC-GEOIP selector in the RuleEditor.** Replaces
  the free-form `<Input>` with a type-ahead combobox backed by
  `GET /api/catalog/geo`. The server parses mihomo's `.dat` files
  (URLs resolved from `profile.geox-url.*` with MetaCubeX defaults)
  via a dependency-free protobuf scanner, caches the parsed category
  lists in-memory for 24h (stale-on-error on refresh), and serves the
  list with per-side independent `error` fields so a broken GEOSITE
  source doesn't block GEOIP. GEOIP entries are uppercased server-side.
  Free-form input is still accepted for custom `.dat` files.
- **Pending-changes viewer with full reset.** The Header's dirty-state
  badge is now a clickable button opening a new `PendingChangesDialog`.
  The modal renders a unified diff (produced by the reused
  `deploy/diff.ts:unifiedDiff` helper) between the masked live config
  and the user's draft via `diff2html`. A destructive "Reset all
  changes" button wraps `config.clearDraft()` behind a `ConfirmDialog`.

### Changed

- **Header dirty badge label retired from a pluralised counter to a
  flag-based "Pending changes".** The `dirtyCount` in the store has
  always been binary (draft differs from live → 1, equal → 0), so the
  old `{count} change | {count} changes` i18n key was misleading — it
  always showed "1 change" regardless of how many lines changed. The
  new label and the `+X / −Y` stats surfaced inside the dialog are
  more honest.
- **`public-key` on WireGuard proxies no longer masked in the vault.**
  Public keys are publishable by definition; vaulting them only hid
  them from the `WireGuardForm` input as `$MIHARBOR_VAULT:<uuid>`,
  which the base64-regex validator rejected. `KNOWN_NON_SECRET_KEYS`
  in `mask.ts` takes precedence over both the exact-match list and
  the `-key` suffix match. `private-key` and `pre-shared-key` continue
  to be masked.

### Fixed

- **Legacy WireGuard drafts transparently migrate on first read.**
  `GET /api/config/draft` now runs any `public-key: $MIHARBOR_VAULT:<uuid>`
  pairs through `migrateDraftPublicKeys()` (batch-resolved via the new
  `Vault.resolveMany()` API), writes the plaintext back to the
  `DraftStore`, and records a `migrate` audit event. Missing uuids are
  preserved and warn-logged rather than thrown. Legacy snapshots
  untouched on disk continue to unmask correctly via the uuid-driven
  `vault.unmaskDoc` path — verified by a dedicated rollback regression
  test.

### Removed

- `apps/web/src/components/layout/DiffViewer.vue` placeholder and its
  orphan `diff.title` / `diff.placeholder` i18n keys. The new
  `PendingChangesDialog` covers the viewer role.

### Tests

- 509 server tests (up from 487), 286 web tests (up from 267).
- Coverage 90.58% line (`apps/server/src`), above the 89.5% target.
- New test files: `catalog/pb-scan.test.ts`, `catalog/geo-cache.test.ts`,
  `catalog/geo-source.test.ts`, `routes/catalog.test.ts`,
  `vault/migrate-public-keys.test.ts`, `catalog-store.spec.ts`,
  `catalog-combobox.spec.ts`, `pending-changes-dialog.spec.ts`,
  `rule-editor-geo.spec.ts`, `header.spec.ts`.

## [0.2.4] — 2026-04-17

Two new config fields on the structured Profile editor plus two deferred
secret-masking fixes from the v0.2.3 audit.

### Added

- **`interface-name` on the Profile page.** Free-form string (eth0 /
  en0 / enp170s0). When this is set AND `tun.auto-detect-interface: true`
  is enabled, a guardrail plate reminds the operator that the explicit
  bind wins — the recommended pattern on multi-homed hosts (see the
  runbook's dual-NIC router invariant).
- **`geox-url` sub-section on the Profile page.** Four labelled URL
  inputs (`geoip`, `geosite`, `mmdb`, `asn`) with per-field "Reset"
  buttons. Empty fields unset the override (mihomo falls back to its
  compiled default). Inline validation rejects non-http(s) values.
  Unknown sub-keys ride along on `extras` so round-tripping a future
  mihomo release is non-destructive.

### Fixed

- **`/api/config/meta` no longer leaks the mihomo `secret:` Bearer.**
  `getMeta()` now substitutes a fixed literal sentinel
  (`__MIHARBOR_SECRET_SET_NOT_SHOWN__`, exported as
  `META_SECRET_SENTINEL` from `miharbor-shared`) whenever a real secret
  is present on disk. The sentinel is stable across polling (unlike
  vault UUIDs that would mint fresh values per call) and the SPA
  recognises it to disable the ProfileForm's reveal-eye toggle. Empty
  / unset secret stays empty — no false-positive "value is configured"
  hint.
- **`/api/config/proxies` no longer leaks WireGuard `private-key` or
  `pre-shared-key`.** `getProxies()` substitutes the real bytes with
  fixed 44-char base64-valid sentinels (`WIREGUARD_PRIVATE_KEY_SENTINEL`
  / `WIREGUARD_PRE_SHARED_KEY_SENTINEL`) so the existing
  `isValidWireGuardKey` regex still accepts them in the form's
  masked-by-default input. Public-key stays verbatim (not a secret;
  clients need it to verify the server). The WireGuardForm disables
  its reveal-eye toggle when the displayed value equals the sentinel
  and round-trips the sentinel unchanged on submit if the operator
  doesn't rotate the key.
- **Deploy pipeline supports sentinel "keep existing value".** If a
  draft reaches `/api/deploy` with any of the three view-scope
  sentinels still in place (operator seeded from `/meta` or `/proxies`
  without going through `/draft`, or the sentinel survived a partial
  edit), the write-reload step looks up the matching on-disk value and
  substitutes it before the YAML hits the filesystem. Scoped narrowly:
  only `secret:` at document root and `private-key` /
  `pre-shared-key` under `proxies[*]` by matching `name` — an
  unrelated scalar that happens to equal the sentinel literal is
  passed through. The diff step resolves sentinels first so the UI
  doesn't show a spurious "secret changed" line.

### Tests

- 647 → **663** server/shared tests (`bun test`), 242 → **263** web
  tests (vitest). Regression tests cover: view projection for
  `interface-name` + `geox-url`; EN/RU i18n parity; ProfileForm
  interface-name guardrail + geox-url reset + inline URL validation;
  `/meta` sentinel substitution + false-positive guard on empty /
  absent secret; `/proxies` sentinel substitution + false-positive
  guard on missing `pre-shared-key`; pipeline sentinel round-trip for
  all three keys + scope-narrowness (literal in unrelated field stays
  put); WireGuardForm sentinel-aware reveal-eye + preservation on
  submit.

---

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
