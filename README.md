# Miharbor

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE) [![Docker](https://img.shields.io/badge/ghcr.io-miharbor-blue)](https://github.com/matrix-aas/miharbor/pkgs/container/miharbor) [Русский](./README.ru.md)

A visual editor for [mihomo](https://github.com/MetaCubeX/mihomo) (Clash-compatible proxy) configs. Runs next to your mihomo daemon, gives you a typed UI for services, proxy-groups, rules, and WireGuard nodes, and deploys changes through a six-step pipeline with automatic rollback and encrypted snapshot history.

## Features

- **Typed UI** for every major section of a mihomo config: services, proxy-groups, rules, rule-providers, WireGuard nodes. No hand-editing YAML unless you want to (raw Monaco view is available, read-only).
- **Six-step deploy pipeline** with staged validation, healthcheck verification, and automatic rollback if mihomo fails to reach a live state after apply.
- **Encrypted snapshot history** — every deploy writes a compressed, AES-256-GCM-sealed snapshot. Full diff view, one-click rollback, configurable retention (count + days).
- **Smart linting** — detects unreachable rules, duplicate group names, dangling references, and mihomo invariant violations before you deploy.
- **Docker-first** — ship as a single container, pinned image, multi-arch (amd64 + arm64).
- **Secret hygiene** — mihomo `secret:`, `private-key:`, `pre-shared-key:` fields are masked in the UI by default and encrypted at rest in snapshot history.
- **EN / RU** UI.

## Screenshots

_(TODO — see `docs/screenshots/` in a future release.)_

## Quick start (Docker)

```bash
# 1. Grab the example compose file and env template.
curl -O https://raw.githubusercontent.com/matrix-aas/miharbor/main/docker-compose.example.yml
curl -O https://raw.githubusercontent.com/matrix-aas/miharbor/main/.env.example
mv docker-compose.example.yml docker-compose.yml
mv .env.example .env

# 2. Generate the three required secrets.

# Mihomo REST API Bearer token — whatever you have in mihomo's `secret:` field.
echo "MIHOMO_API_SECRET=$(grep -E '^secret:' /etc/mihomo/config.yaml | awk '{print $2}' | tr -d '\"')" >> .env

# Admin password hash (Argon2id).
PASSWORD="change-me-now"
HASH=$(docker run --rm oven/bun:1.3.11-alpine \
  bun -e "console.log(await Bun.password.hash(\"$PASSWORD\"))")
echo "MIHARBOR_AUTH_PASS_HASH=$HASH" >> .env

# Snapshot-vault key (32 bytes hex).
echo "MIHARBOR_VAULT_KEY=$(openssl rand -hex 32)" >> .env

# 3. Launch.
docker compose up -d

# 4. Put a reverse proxy (nginx/caddy/traefik) in front of 127.0.0.1:3000
#    with TLS, then open https://miharbor.yourdomain/.
```

Log in with `admin` + the password you picked above.

## Production checklist

Read this before exposing Miharbor outside `localhost`.

- [ ] **Change the admin password.** If you didn't set `MIHARBOR_AUTH_PASS_HASH`, Miharbor boots with a mandatory password-change prompt — honour it.
- [ ] **Put a reverse proxy in front.** `127.0.0.1:3000` is the designed exposure; public ports should only hit nginx/caddy/traefik with TLS.
- [ ] **Back up `MIHARBOR_VAULT_KEY`.** Losing it makes the entire snapshot history unreadable. Keep a copy outside the `miharbor_data` volume.
- [ ] **Back up `MIHARBOR_DATA_DIR`.** See [`docs/BACKUP.md`](./docs/BACKUP.md).
- [ ] **Set `MIHARBOR_TRUSTED_PROXY_CIDRS` if using trust headers.** Without it, anyone reaching the container can spoof `X-Forwarded-User: admin` and bypass auth. The default is empty = trust disabled, which is safe.
- [ ] **Consider a WAF / brute-force layer** — Miharbor has an internal per-IP rate limiter on `/api/auth/*`, but CrowdSec / Authelia in front of the reverse proxy is stronger.

## Architecture

```
 ┌──────────────────┐      HTTPS (via reverse proxy)
 │  Your browser    │ ◀──────────────────────────────┐
 └──────────────────┘                                │
                                                     │
                                      ┌──────────────┴───────────┐
                                      │ Miharbor (Docker)        │
                                      │  ┌─────────────────────┐ │
                                      │  │ Elysia (Bun) :3000  │ │
                                      │  │  /api + static SPA  │ │
                                      │  └──────────┬──────────┘ │
                                      │             │            │
                                      │  bind-mount /config      │
                                      │  (mihomo config.yaml)    │
                                      │             │            │
                                      └─────────────┼────────────┘
                                                    │ reload via REST
                                      ┌─────────────▼────────────┐
                                      │   mihomo (host / other)  │
                                      └──────────────────────────┘
```

Miharbor never edits the mihomo process directly — it writes `/config/config.yaml` (bind-mounted) and then calls `PUT /configs?force=true` on mihomo's REST API to trigger a reload. Rollback uses the same mechanism in reverse: restore the prior snapshot's YAML to disk and reload.

## Modes (transports)

- **Docker + LocalFs** _(v0.1, default)_ — Miharbor runs in a container, bind-mounts the host's mihomo config directory. Shortest path to a working setup.
- **SSH** _(planned, v0.2)_ — Miharbor runs on a jump host and deploys to a remote mihomo over SSH. The transport interface is already abstracted, the SSH implementation is the only missing piece.

## Supported mihomo versions

CI smoke-tests aim for the current three: **1.18.x, 1.19.x, 1.20.x**. In practice any post-1.18 build that keeps the `/configs` REST endpoint works. Older `clash.meta` builds may work but aren't tested.

## Configuration

All configuration is via environment variables. Defaults shown are what Miharbor falls back to if the variable is unset.

| Variable                            | Default                            | Purpose                                                           |
| ----------------------------------- | ---------------------------------- | ----------------------------------------------------------------- |
| `MIHARBOR_PORT`                     | `3000`                             | HTTP listen port inside the container.                            |
| `MIHARBOR_TRANSPORT`                | `local`                            | `local` (bind-mount) or `ssh` (planned).                          |
| `MIHARBOR_CONFIG_PATH`              | `/config/config.yaml`              | Path to mihomo's config inside the container.                     |
| `MIHARBOR_DATA_DIR`                 | `/app/data`                        | Miharbor's own persistent state (snapshots, vault, auth).         |
| `MIHARBOR_WEB_DIST`                 | _(set in image)_                   | Directory with the pre-built Vue bundle. Unset = API-only mode.   |
| `MIHOMO_API_URL`                    | `http://host.docker.internal:9090` | mihomo REST API base URL.                                         |
| `MIHOMO_API_SECRET`                 | _(empty, required)_                | mihomo REST API Bearer token.                                     |
| `MIHARBOR_AUTH_USER`                | `admin`                            | Admin username.                                                   |
| `MIHARBOR_AUTH_PASS_HASH`           | _(empty)_                          | Argon2id hash. Empty = bootstrap mode (forces password change).   |
| `MIHARBOR_AUTH_DISABLED`            | `false`                            | Dev escape hatch. Never enable in production.                     |
| `MIHARBOR_VAULT_KEY`                | _(empty, required)_                | 32-byte hex key for snapshot-vault AES-256-GCM.                   |
| `MIHARBOR_TRUST_PROXY_HEADER`       | _(empty)_                          | Header name to trust for user identity (e.g. `X-Forwarded-User`). |
| `MIHARBOR_TRUSTED_PROXY_CIDRS`      | _(empty)_                          | CIDRs allowed to set the trust header (e.g. `127.0.0.1/32`).      |
| `MIHARBOR_SNAPSHOT_RETENTION_COUNT` | `50`                               | Keep at most N most-recent snapshots.                             |
| `MIHARBOR_SNAPSHOT_RETENTION_DAYS`  | `30`                               | Prune snapshots older than N days.                                |
| `MIHARBOR_AUTO_ROLLBACK`            | `true`                             | If healthcheck fails after deploy, auto-restore prior snapshot.   |
| `MIHARBOR_LOG_LEVEL`                | `info`                             | `debug` / `info` / `warn` / `error`.                              |
| `MIHARBOR_LLM_DISABLED`             | `false`                            | Hide LLM-assistant UI and endpoints (planned for v0.2+).          |

## Development

Prerequisites: [Bun 1.3.11+](https://bun.sh/).

```bash
git clone https://github.com/matrix-aas/miharbor
cd miharbor
bun install

# Terminal 1 — server (Elysia :3000)
MIHARBOR_AUTH_DISABLED=true \
MIHARBOR_DATA_DIR=./.local-data \
MIHARBOR_CONFIG_PATH=./.local-data/config.yaml \
MIHARBOR_VAULT_KEY=00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff \
bun run server:dev

# Terminal 2 — Vite dev server (:5173, proxies /api to :3000)
bun run web:dev

# Tests
bun test                           # server + shared
bun run --filter miharbor-web test # web (Vitest)
```

See [`docs/superpowers/plans/`](./docs/superpowers/) for the staged implementation plans.

## Roadmap

- **v0.1 (MVP — current)**: Services, Proxies, Raw YAML (read-only), History with rollback, Settings, Onboarding. LocalFs transport only.
- **v0.2**: Full DNS / TUN / Sniffer / Rule-providers UI, SSH transport, complete RU translation, tree-mode AND/OR rule builder.
- **v1.0**: LLM-assisted refactoring suggestions, DNS+GEOIP linter, "import node from URL" flow, automation API.

## Security

See [`SECURITY.md`](./SECURITY.md) for the threat model and vulnerability disclosure process.

## License

[MIT](./LICENSE).
