# SSH transport — run Miharbor away from mihomo

The **SSH transport** lets Miharbor run on your workstation (Mac, dev VM,
jump host) while the mihomo config it edits lives on a remote server
(router, home-server, etc.). Miharbor reads/writes `config.yaml` over
SFTP, runs `mihomo -t` for validation via SSH `exec`, and triggers reload
through the mihomo REST API like the local transport does.

When to use it:

- You don't want to deploy Miharbor _on_ the router (small disk,
  minimal OS image, scope-of-impact concerns).
- You already have a hardened SSH path to the router and want Miharbor
  to piggy-back on that same trust boundary.
- You want snapshot history stored on a different host than the live
  config — e.g. on your workstation where you already back things up.

## Prerequisites on the remote host

| Thing                                                                 | Why                                                |
| --------------------------------------------------------------------- | -------------------------------------------------- |
| `mihomo` binary on `$PATH`                                            | validation runs `mihomo -t -d /tmp/miharbor-test/` |
| `flock(1)` — or fallback to `mkdir` lock                              | serialises writes against external editors         |
| `sh`, `mkdir`, `rmdir`, `mv`, `sync`, `kill`, `sleep`, `date`, `stat` | coreutils used by the lock + atomic-write helpers  |
| write access to the mihomo config directory for the SSH user          | Miharbor writes via SFTP under that user           |

All of the above are part of base Debian/Ubuntu/Alpine. If your remote is
a stripped-down image without `flock(1)`, Miharbor falls back to a
directory-based advisory lock. Both are documented below.

## Environment variables

All SSH settings share the `MIHARBOR_SSH_*` prefix. They are read **only**
when `MIHARBOR_TRANSPORT=ssh`; otherwise the server ignores them.

| Variable                             | Default                      | Purpose                                                                                                     |
| ------------------------------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `MIHARBOR_TRANSPORT`                 | `local`                      | Set to `ssh` to activate this transport.                                                                    |
| `MIHARBOR_SSH_HOST`                  | — (required)                 | Hostname / IP of the remote.                                                                                |
| `MIHARBOR_SSH_PORT`                  | `22`                         | SSH port.                                                                                                   |
| `MIHARBOR_SSH_USER`                  | — (required)                 | Remote login user. Must have write access to the mihomo config dir.                                         |
| `MIHARBOR_SSH_KEY_PATH`              | _(empty → agent)_            | Absolute path to a private key file. Supports OpenSSH, PEM-PKCS#1, PEM-PKCS#8 — encrypted or not.           |
| `MIHARBOR_SSH_KEY_PASSPHRASE`        | _(empty)_                    | Passphrase for an encrypted key. Ignored when the key is plaintext or when agent auth is used.              |
| `MIHARBOR_SSH_REMOTE_CONFIG_PATH`    | `/etc/mihomo/config.yaml`    | Absolute path of the live mihomo config on the remote.                                                      |
| `MIHARBOR_SSH_REMOTE_LOCK_PATH`      | `/etc/mihomo/.miharbor.lock` | Absolute path of the remote lock sidecar. Must live on the same filesystem as the config so `mv` is atomic. |
| `MIHARBOR_SSH_CONNECT_TIMEOUT_MS`    | `10000`                      | SSH `readyTimeout`.                                                                                         |
| `MIHARBOR_SSH_KEEPALIVE_INTERVAL_MS` | `30000`                      | SSH keepalive; `0` disables.                                                                                |
| `MIHARBOR_SSH_KNOWN_HOSTS`           | _(empty)_                    | Absolute path to an OpenSSH `known_hosts`-format file. When set, Miharbor pins the remote host key.         |
| `MIHARBOR_SSH_HOST_KEY_INSECURE`     | `false`                      | Explicit opt-in for "accept any host key" (`StrictHostKeyChecking=no`). Use only for first-contact/testing. |

The rest of the env vars (`MIHOMO_API_URL`, `MIHOMO_API_SECRET`,
`MIHARBOR_DATA_DIR`, `MIHARBOR_VAULT_KEY`, auth) have the same meaning as
for the local transport. Snapshots and vault live on the **Miharbor
host** (local `MIHARBOR_DATA_DIR`), not on the remote.

## Authentication modes — in order of preference

### 1. ssh-agent (preferred on laptops)

Leave `MIHARBOR_SSH_KEY_PATH` unset. Miharbor picks up the agent socket
from `$SSH_AUTH_SOCK`. On macOS that's usually set automatically; on
Linux make sure `ssh-agent` is running and your key is loaded
(`ssh-add -L`).

```bash
MIHARBOR_TRANSPORT=ssh \
MIHARBOR_SSH_HOST=router.local \
MIHARBOR_SSH_USER=matrix \
bun run server:dev
```

### 2. Unencrypted key on disk

```bash
MIHARBOR_TRANSPORT=ssh \
MIHARBOR_SSH_HOST=router.local \
MIHARBOR_SSH_USER=matrix \
MIHARBOR_SSH_KEY_PATH=/home/matrix/.ssh/miharbor_ed25519 \
bun run server:dev
```

Permission hygiene: the key file must be readable by the Miharbor
process user and ideally `chmod 600`.

### 3. Passphrase-encrypted key

```bash
MIHARBOR_TRANSPORT=ssh \
MIHARBOR_SSH_HOST=router.local \
MIHARBOR_SSH_USER=matrix \
MIHARBOR_SSH_KEY_PATH=/home/matrix/.ssh/miharbor_ed25519 \
MIHARBOR_SSH_KEY_PASSPHRASE=hunter2 \
bun run server:dev
```

In production, prefer injecting the passphrase via a secret-management
tool (`docker secret`, `systemd-creds`, etc.) rather than a literal env
assignment. Miharbor never logs the passphrase — it's only forwarded to
ssh2's decrypt path.

## Atomic write protocol

Each deploy goes through this sequence:

1. Acquire remote lock (`flock -xn` on `MIHARBOR_SSH_REMOTE_LOCK_PATH`;
   `mkdir` fallback if `flock(1)` is missing).
2. SFTP `fastPut` the new bytes to a tmp sibling of the target —
   `.miharbor.tmp.config.yaml` in the same directory.
3. Run `sync && mv <tmp> <target>` over SSH exec. Since `mv(1)` is
   `rename(2)` on the same filesystem, this is atomic — no reader ever
   sees a half-written file.
4. Release the lock (kill the `flock` sleeper, or `rmdir` the advisory
   dir).

The tmp path is **adjacent** to the target, not in `/tmp/`, because
`mv` across mount points is a copy-then-unlink — not atomic and not
lock-preserving. Don't symlink the mihomo config into another fs.

## Validation protocol

`runMihomoValidate` behaviour in SSH mode:

1. `mkdir -p /tmp/miharbor-test && chmod 700 /tmp/miharbor-test`
2. SFTP upload draft to `/tmp/miharbor-test/config.yaml`
3. `mihomo -t -d /tmp/miharbor-test/`
4. Parse `stdout + stderr`; `exit 0` ⇒ `ok`, non-zero ⇒ parsed error.

If you don't want Miharbor to be able to write into `/tmp/` on the
remote, set `MIHOMO_API_VALIDATION_MODE=shared-only` which keeps the
validation local to the Miharbor process (YAML parse + linter only).
Operators usually want the real thing; `shared-only` catches 90% of
goofs but not e.g. unknown mihomo keys.

## Locking — flock vs mkdir

Miharbor tries `flock(1)` first. Acquisition works like this:

```sh
# Equivalent to the real command Miharbor issues internally.
setsid sh -c 'flock -xn 9 || exit 1; echo $$; exec sleep infinity' \
  9> /etc/mihomo/.miharbor.lock < /dev/null > /tmp/.miharbor-flock.pid 2>&1 &
```

The sleeper holds the lock for the duration of the write; release is
`kill <pid>`. **Benefit**: if the Miharbor process dies unexpectedly or
the SSH connection drops, the kernel releases the open FD and the lock
goes away automatically.

Fallback (no `flock`): a lock directory at
`MIHARBOR_SSH_REMOTE_LOCK_PATH`. `mkdir` is atomic on POSIX so only one
writer wins. **Caveat**: if the creator dies, the lock persists. The
fallback steals any lock dir older than 30 seconds. Use `flock` if you
can; the fallback is last-resort.

You'll know which path was taken by grepping Miharbor logs for
`ssh-lock:` entries.

## Example docker-compose

```yaml
services:
  miharbor:
    image: ghcr.io/matrix-aas/miharbor:latest
    container_name: miharbor
    restart: unless-stopped
    ports:
      - '127.0.0.1:3000:3000'
    volumes:
      # Snapshots + vault + auth state live on the Miharbor host, not the router.
      - miharbor_data:/app/data
      # Mount your SSH private key (read-only) — or use a docker secret.
      - /home/matrix/.ssh/miharbor_ed25519:/ssh/key:ro
      # Pinned host-key file (generate once with `ssh-keyscan -t ed25519,rsa,ecdsa`).
      - /etc/miharbor/known_hosts:/ssh/known_hosts:ro
    environment:
      MIHARBOR_TRANSPORT: ssh
      MIHARBOR_SSH_HOST: router.lan
      MIHARBOR_SSH_USER: matrix
      MIHARBOR_SSH_KEY_PATH: /ssh/key
      # Passphrase, if the key is encrypted. Prefer docker secret over env.
      # MIHARBOR_SSH_KEY_PASSPHRASE: ${MIHARBOR_SSH_KEY_PASSPHRASE}
      MIHARBOR_SSH_REMOTE_CONFIG_PATH: /etc/mihomo/config.yaml
      MIHARBOR_SSH_REMOTE_LOCK_PATH: /etc/mihomo/.miharbor.lock
      # Host-key verification — pick ONE (Miharbor refuses to start otherwise).
      MIHARBOR_SSH_KNOWN_HOSTS: /ssh/known_hosts
      # Lab / first-contact escape hatch (NOT SAFE on hostile networks):
      # MIHARBOR_SSH_HOST_KEY_INSECURE: 'true'
      MIHARBOR_DATA_DIR: /app/data
      # mihomo REST API — reachable from Miharbor's vantage point. Typically
      # the same host you SSH into, bound to a LAN IP or reachable via
      # port-forward.
      MIHOMO_API_URL: http://router.lan:9090
      MIHOMO_API_SECRET: ${MIHOMO_API_SECRET}
      MIHARBOR_AUTH_USER: admin
      MIHARBOR_AUTH_PASS_HASH: ${MIHARBOR_AUTH_PASS_HASH}
      MIHARBOR_VAULT_KEY: ${MIHARBOR_VAULT_KEY}

volumes:
  miharbor_data:
```

## Troubleshooting

### `no authentication configured` on startup

Neither `MIHARBOR_SSH_KEY_PATH` nor `SSH_AUTH_SOCK` resolved to
something usable. Check:

- `echo $SSH_AUTH_SOCK` from the Miharbor container (agent forwarding
  does NOT cross a `docker run` boundary by default — bind-mount the
  socket explicitly).
- File permissions on `MIHARBOR_SSH_KEY_PATH` — Miharbor needs read
  access as the process user.

### `cannot read MIHARBOR_SSH_KEY_PATH=…: ENOENT`

Your `.env` path is not visible from inside the container. Either
bind-mount the key file, or copy the key into the image at build time
(not recommended — image layers leak).

### `ssh-lock: failed to acquire … after 11 attempts`

Another writer is holding the lock. If there's no other Miharbor
instance and no `vim` editing the file, the lock is stale. Removing it
is safe:

```bash
# flock variant — the sleeper is bound to a PID; check and kill.
ssh user@host 'pgrep -af "exec sleep infinity" | grep -v grep'
ssh user@host 'kill <pid>'

# mkdir variant — just rmdir.
ssh user@host 'rmdir /etc/mihomo/.miharbor.lock'
```

### `atomic rename failed` during deploy

The tmp file uploaded fine but `mv` refused. Usually:

- `remoteConfigPath` and `remoteLockPath` are on different
  filesystems — `mv` becomes copy-then-unlink and fails under lock.
  Fix: put them in the same dir on the remote.
- The SSH user lost write permission on the config dir
  (`chown -R` surprise) — re-grant write on the dir, not just the file.

### `mihomo -t` fails but Miharbor insists on reloading anyway

Shouldn't happen — the pipeline blocks on non-`ok` validate. If you see
this, you probably set `MIHOMO_API_VALIDATION_MODE=shared-only` which
skips the real mihomo check. That's fine for development, dangerous for
production.

## Host-key verification

Miharbor **refuses to start** in SSH mode unless you tell it how to verify
the remote host key. Picking one of the two options below is a two-minute
setup that closes the MITM foot-gun a silent accept-any client has.

### Option A — pin against a `known_hosts` file (recommended)

```bash
# 1. Fetch the remote host keys (run this once; repeat after key rotation).
#    Drop `-H` so the parser can read the host patterns; Miharbor does
#    not support OpenSSH's hashed-hostname format yet.
ssh-keyscan -t ed25519,rsa,ecdsa router.lan > /etc/miharbor/known_hosts
chmod 644 /etc/miharbor/known_hosts

# 2. (Optional) verify by eye against the fingerprint the remote admin
#    reads off the console at `ssh-keygen -l -f /etc/ssh/ssh_host_ed25519_key.pub`.
ssh-keygen -lf /etc/miharbor/known_hosts

# 3. Wire it up.
export MIHARBOR_SSH_KNOWN_HOSTS=/etc/miharbor/known_hosts
```

Miharbor's `hostVerifier` compares the server's offered public key against
this file on every connect. Mismatch aborts the connection with a logged
`SHA256:` fingerprint of the offending key so you can investigate
(rotated key? actual MITM? stale `known_hosts`?).

Supported subset of the format:

- `host[,alt] keytype base64key` — the common case.
- `[host]:port keytype base64key` — non-standard port.
- Comments (`#...`) and blank lines.

Not supported yet (lines are skipped with a warning):

- Hashed hostnames (`|1|salt|hash`).
- `@cert-authority` / `@revoked` markers.

### Option B — explicit insecure opt-in (first contact / lab)

```bash
export MIHARBOR_SSH_HOST_KEY_INSECURE=true
```

This skips `hostVerifier` entirely — equivalent to
`StrictHostKeyChecking=no`. Miharbor emits a WARN log line at every
connect so you can't forget you left it on. Use this only to bootstrap
against a host whose fingerprint you don't have yet: connect, copy the
fingerprint out of the next log line, generate a `known_hosts` file,
switch to Option A.

### What happens if neither is set

`wireApp()` throws at bootstrap:

```
MIHARBOR_TRANSPORT=ssh requires host-key verification: set
MIHARBOR_SSH_KNOWN_HOSTS to a known_hosts-format file path (preferred)
or MIHARBOR_SSH_HOST_KEY_INSECURE=true to explicitly accept any host key.
```

This is intentional. An operator who can wire SSH at all can spend two
minutes pointing us at `~/.ssh/known_hosts`; the cost of surfacing this
misconfiguration at startup is ~0. The cost of a silent MITM against an
un-pinned SshTransport is every secret the mihomo config has ever held.

## Security notes

- **Host-key verification is on by default** (via the two env vars above).
  No more MVP asterisk: unless you explicitly set
  `MIHARBOR_SSH_HOST_KEY_INSECURE=true`, Miharbor pins the remote key or
  refuses to start.
- **Miharbor reuses one persistent SSH connection.** On peer close the
  next operation reconnects lazily. `SIGTERM` triggers `dispose()` which
  calls `ssh2.Client.end()` — no zombie connection left behind.
- **Snapshots and vault never leave the Miharbor host.** Even if the
  remote mihomo host is ephemeral, Miharbor's audit trail is intact.
- **The SSH user does NOT need root.** It needs write access to the
  config file and the ability to run `mihomo -t`. Many setups set
  `sudoers: NOPASSWD` on `mihomo` specifically; you can wrap that with
  a helper script if desired.
