# Backup & Recovery

Miharbor keeps two distinct kinds of persistent state that you must back up separately.

## What to back up

### 1. `MIHARBOR_DATA_DIR` (default `/app/data`)

Inside the Docker image this is mapped to the `miharbor_data` named volume in `docker-compose.example.yml`. It contains:

| File / dir              | What it is                                                                      | Lose it and...                                                                      |
| ----------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `snapshots/*.snap`      | Encrypted YAML snapshots (one per deploy)                                       | You lose deploy history, but live config is unaffected.                             |
| `snapshots/*.meta.json` | Snapshot metadata (timestamp, author, trigger, parent hash)                     | Snapshots become anonymous but still readable.                                      |
| `secrets-vault.enc`     | AES-256-GCM-sealed real values for every secret sentinel referenced in `*.snap` | You can read the snapshot YAML but all sensitive fields show sentinel placeholders. |
| `.vault-key`            | Stored per-install AES key (only if `MIHARBOR_VAULT_KEY` isn't pinned via ENV)  | **All snapshots become unrecoverable.** See below.                                  |
| `auth.json`             | Admin username + Argon2id password hash (mode 600)                              | You can't log in; recovery = set `MIHARBOR_AUTH_PASS_HASH` ENV and restart.         |
| `audit.log`             | Append-only NDJSON audit trail (every login, deploy, rollback)                  | Forensic trail lost; not operationally blocking.                                    |
| `config.yaml.lock`      | Runtime flock file                                                              | Ephemeral; regenerated on every deploy.                                             |

### 2. `MIHARBOR_VAULT_KEY`

This is the 32-byte (64 hex chars) AES-256-GCM key that encrypts `secrets-vault.enc`. **Losing it destroys your entire snapshot history**, because every `*.snap` file references sentinels whose real values are inside `secrets-vault.enc`, which can't be decrypted without the key.

**Store the key somewhere OTHER than the `miharbor_data` volume.**

Good places:

- A password manager (1Password, Bitwarden, `pass`).
- An offline encrypted backup (`age` / `gpg` of a text file).
- Your infrastructure secrets system (HashiCorp Vault, AWS Secrets Manager, Doppler).

Bad places:

- The same volume as `secrets-vault.enc`. A single lost volume = full loss.
- A plain `.env` committed to git. (`.env` is in `.gitignore` already — make sure it stays there.)

### 3. The host's mihomo `config.yaml`

This is what Miharbor edits. If you lose it AND every Miharbor snapshot AND the vault key, you need to rebuild mihomo from scratch. Keep a copy of `/etc/mihomo/config.yaml` (or equivalent) in your usual infrastructure backup. Miharbor's snapshots ARE backups of this file — but only as long as the vault key is safe.

## Backup commands

### Named-volume snapshot (docker-compose case)

```bash
# Creates ./miharbor-backup-2026-04-16.tar.gz
docker run --rm \
  -v miharbor_data:/data:ro \
  -v "$(pwd)":/backup \
  alpine:latest \
  tar czf /backup/miharbor-backup-$(date +%F).tar.gz -C / data
```

### Bind-mount case

If you're bind-mounting a host directory (e.g. `-v /opt/miharbor/data:/app/data`), just back that directory up with your existing tool:

```bash
# rsync, restic, borg, tarsnap, whatever you already use.
restic -r /path/to/repo backup /opt/miharbor/data /etc/mihomo
```

### Vault-key escrow

```bash
# If you pinned MIHARBOR_VAULT_KEY in an env file:
cp /path/to/.env /path/to/offline/backup/

# Or extract from a running container (requires shell access):
docker exec miharbor sh -c 'cat /app/data/.vault-key' > ~/.secrets/miharbor.vault-key
chmod 600 ~/.secrets/miharbor.vault-key
```

### Automated crontab example

```cron
# Back up Miharbor state + host mihomo config nightly at 03:17 MSK.
17 3 * * * docker run --rm -v miharbor_data:/data:ro -v /var/backups/miharbor:/backup alpine:latest tar czf /backup/miharbor-$(date +\%F).tar.gz -C / data && find /var/backups/miharbor -name 'miharbor-*.tar.gz' -mtime +14 -delete
```

## Restore

1. Stop the container: `docker compose down`.
2. Restore the `miharbor_data` volume:
   ```bash
   docker run --rm \
     -v miharbor_data:/data \
     -v "$(pwd)":/backup \
     alpine:latest \
     sh -c 'cd / && tar xzf /backup/miharbor-backup-2026-04-16.tar.gz'
   ```
3. Make sure your `.env` still has the SAME `MIHARBOR_VAULT_KEY` as the backup. (If the key was file-based inside the volume, skip this step.)
4. `docker compose up -d` and open the UI — History should show every restored snapshot.

## Disaster scenarios

| Scenario                                                 | Recovery                                                                                                                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container crashed, volume intact                         | `docker compose up -d` — no data loss.                                                                                                                           |
| Volume lost, vault key backed up, snapshot tar backed up | Restore tar, verify `.vault-key` matches, restart. Full recovery.                                                                                                |
| Volume lost, vault key backed up, NO snapshot backup     | Only the live mihomo `config.yaml` remains. Rebuild from there.                                                                                                  |
| Vault key lost                                           | Snapshot history is permanently unreadable. `config.yaml` is unaffected. Reset: delete `miharbor_data`, redeploy with new key, seed from the live `config.yaml`. |
| Password hash + vault key both lost                      | Set a fresh `MIHARBOR_AUTH_PASS_HASH` via ENV, reset vault as above, log in, resume.                                                                             |

## Testing your backups

Once a quarter, simulate a restore on a disposable machine. A backup you've never tested is a backup you don't have.
