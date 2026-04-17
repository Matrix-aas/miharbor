# Security Policy

## Supported Versions

Security fixes land on the latest stable release. During Stage 1 (v0.1.x), the default is to patch only `main` + the latest tagged release.

| Version            | Supported |
| ------------------ | --------- |
| `v0.1.x` (current) | yes       |
| Older              | no        |

## Reporting a Vulnerability

Please do **not** open public GitHub issues for security reports. Instead email **matrix.aas@gmail.com** with:

- A short description of the problem.
- Reproduction steps (if applicable).
- The Miharbor version affected (`docker inspect ghcr.io/matrix-aas/miharbor:<tag>` or `git rev-parse HEAD` on a dev checkout).

Expect an acknowledgement within 72 hours. Coordinated disclosure: we aim to ship a fix before public discussion, and we will credit the reporter in the release notes unless you prefer otherwise.

## Threat Model

The seven primary attack vectors we care about, and the mitigations in place. Full rationale lives in [`docs/superpowers/specs/2026-04-16-miharbor-design.md`](./docs/superpowers/specs/2026-04-16-miharbor-design.md) §10.

### 1. RCE via YAML parse

Miharbor parses mihomo YAML configs on every load. Mitigation: [`yaml@2`](https://www.npmjs.com/package/yaml) does not support `!!js/function` or other unsafe-eval types. We track upstream CVEs and bump promptly. We do not use `js-yaml` or any `!!` custom tag handlers.

### 2. Prompt injection via LLM context

_(Feature planned for v0.2+.)_ The LLM assistant only receives an allow-list of config sections: `rules`, `proxy-groups` (names + type, no `proxies` arrays), `rule-providers` (name/type/behavior only). It never sees `proxies`, `dns`, `tun`, `sniffer`, `external-controller`, `secret`, or top-level comments. Mitigation: `packages/shared/llm/context-allowlist.ts` (planned) is guarded by a test.

### 3. Secret exfil via snapshot history

Every snapshot YAML contains sensitive fields (private keys, pre-shared keys, `secret:` tokens). Mitigation: **sentinel-vault**. Secret values are replaced with sentinel IDs before the snapshot is written; the real values are stored in `${MIHARBOR_DATA_DIR}/secrets-vault.enc`, encrypted with AES-256-GCM using `MIHARBOR_VAULT_KEY`. The vault file and `.vault-key` are created with mode `0600`.

### 4. Basic Auth bypass via trust-header spoof

When an operator puts Miharbor behind a reverse proxy that sets `X-Forwarded-User` (Authelia, Keycloak, etc.), a malicious client could set the same header directly and bypass auth. Mitigation: `MIHARBOR_TRUST_PROXY_HEADER` is ignored unless the request source IP is inside `MIHARBOR_TRUSTED_PROXY_CIDRS`. Defaults: both empty → trust completely disabled → header-spoof impossible.

### 5. SSH key abuse via unencrypted key

_(For the planned SSH transport in v0.2.)_ If the SSH key on disk isn't passphrase-protected, anyone with read access to `${MIHARBOR_DATA_DIR}` can use it. Mitigation: documentation recommends `ssh-agent` forwarding or a passphrase; the backend never persists passphrases.

### 6. Race condition on parallel write

Two concurrent deploys (e.g. two operators clicking Apply) could interleave partial writes and corrupt `config.yaml`. Mitigation: `flock` around every write, plus a SHA-256 hash check between the snapshot's parent hash and the live file's current hash. If they don't match, the deploy fails with `CONFIG_CHANGED_EXTERNALLY`.

### 7. Malicious Docker image supply chain

An operator `docker pull`-ing a tag expects the image to be the one we built. Mitigation: GHCR images are pushed only from a tag-protected GitHub Actions workflow with `id-token: write` for future image signing, and every release attaches an SBOM (Syft) so downstream users can audit the dependency surface.

## Out of scope

- **Client-side compromise.** If the browser is compromised (keylogger, malicious extension) we can't defend the credentials. Use a hardened workstation for admin access.
- **Physical access to the host.** Disk encryption is the operator's responsibility; Miharbor's vault protects against opportunistic filesystem reads but not against a rooted host.
- **Denial of service.** Rate-limiter on `/api/auth/*` handles brute-force but not volumetric DDoS. Use a WAF / Cloudflare / CrowdSec for that tier.

## Security-adjacent operational recommendations

- Put Miharbor behind a reverse proxy with TLS (never expose `:3000` directly).
- Run the container as the default non-root `bun` user (the image does this already).
- Store `MIHARBOR_VAULT_KEY` outside the `miharbor_data` volume — losing both simultaneously destroys snapshot history.
- Regularly rotate `MIHOMO_API_SECRET` (bearer token). Miharbor will pick up the new value on container restart.
- Enable CrowdSec or Authelia in front of the reverse proxy for L3 IP-based banning.
