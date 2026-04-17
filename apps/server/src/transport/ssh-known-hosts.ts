// known_hosts parser + matcher for SSH host-key verification.
//
// Why this file exists: without a `hostVerifier` callback, ssh2 accepts any
// host key — the TLS equivalent of `StrictHostKeyChecking=no`. For v0.2.0
// we want operators to be able to pin the remote key against an OpenSSH
// `known_hosts`-format file (generated once with `ssh-keyscan -H`) without
// pulling in a heavy dependency. The parser below handles the common subset:
//
//   hostpattern[,host2] keytype base64key [comment]
//
// It deliberately does NOT implement:
//   - Hashed host entries (`|1|salt|hash`). OpenSSH supports a HMAC-SHA1 of
//     the hostname; we'd need to recompute it per-lookup. For the initial
//     rollout most operators paste the plain form (`ssh-keyscan -t ed25519
//     host`) or use `ssh-keyscan -H` output. If a hashed line is
//     encountered, it's ignored with a warning — callers should re-run
//     `ssh-keyscan` without `-H`, or we extend this parser later.
//   - `@cert-authority` / `@revoked` markers. We skip them (TODO: honour
//     revocation — until then, rotate the whole file on key rotation).
//   - Negated patterns (`!host`). Patterns are matched as literal equality
//     or wildcard-free hostnames.
//
// Fingerprint format used in log messages is `SHA256:<base64>` matching
// `ssh-keygen -l -E sha256` output — short, grep-friendly, and it's a hash
// of a public key, which is safe to log (no secret material).
//
// Performance: parseKnownHosts is cached per-path at the call site
// (see ssh-adapter.ts). For a 100-entry file, a linear host scan per
// connect is dwarfed by the SSH handshake itself — no indexing needed.

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

/** One parsed `known_hosts` entry. */
export interface KnownHostEntry {
  /** Raw host patterns list (`host[:port]` or `[host]:port` or bare `host`). */
  hostPatterns: string[]
  /** Key type: `ssh-rsa`, `ssh-ed25519`, `ecdsa-sha2-nistp256`, etc. */
  keyType: string
  /** Raw public key bytes (base64-decoded from the file). */
  keyBytes: Buffer
}

/** Parse `known_hosts` text into entries. Never throws — malformed lines
 *  are dropped with a warning via the caller's logger (if provided). */
export function parseKnownHosts(
  content: string,
  warn: (msg: string) => void = () => {},
): KnownHostEntry[] {
  const out: KnownHostEntry[] = []
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!
    const line = raw.trim()
    // Skip blanks and comments.
    if (line.length === 0 || line.startsWith('#')) continue
    // Skip marker-prefixed lines for now. Keeps API surface small; see
    // module header comment for the TODO.
    if (line.startsWith('@cert-authority') || line.startsWith('@revoked')) {
      warn(`known_hosts:${i + 1}: ignoring marker-prefixed entry (not supported in MVP)`)
      continue
    }
    const parts = line.split(/\s+/)
    if (parts.length < 3) {
      warn(`known_hosts:${i + 1}: malformed line (want: host keytype base64key)`)
      continue
    }
    const [hostField, keyType, keyB64] = parts as [string, string, string]
    // Hashed host pattern — we cannot match it without HMAC recomputation.
    if (hostField.startsWith('|1|')) {
      warn(
        `known_hosts:${i + 1}: hashed hostname entries are not supported; ` +
          `re-run ssh-keyscan without -H or add an unhashed line`,
      )
      continue
    }
    let keyBytes: Buffer
    try {
      keyBytes = Buffer.from(keyB64, 'base64')
      if (keyBytes.length === 0) throw new Error('empty key bytes')
    } catch (e) {
      warn(`known_hosts:${i + 1}: invalid base64 key (${(e as Error).message})`)
      continue
    }
    out.push({
      hostPatterns: hostField
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      keyType,
      keyBytes,
    })
  }
  return out
}

/** Load + parse a known_hosts file. Thin async wrapper over `parseKnownHosts`. */
export async function loadKnownHosts(
  path: string,
  warn: (msg: string) => void = () => {},
): Promise<KnownHostEntry[]> {
  const buf = await readFile(path, 'utf8')
  return parseKnownHosts(buf, warn)
}

/** Build the host lookup key(s) to match against `hostPatterns`. OpenSSH
 *  writes port-22 hosts as the bare hostname, and non-standard ports as
 *  `[host]:port`. We check both forms to accept either style. */
export function hostMatchCandidates(host: string, port: number): string[] {
  const candidates = new Set<string>()
  if (port === 22) {
    candidates.add(host)
  }
  // `[host]:port` is also valid for :22 in OpenSSH — accept both.
  candidates.add(`[${host}]:${port}`)
  return [...candidates]
}

/** Returns true when `key` (raw bytes from ssh2's hostVerifier callback)
 *  matches any entry in `entries` whose pattern list contains `host` (or
 *  `[host]:port` for non-standard ports). */
export function keyMatchesKnownHost(
  entries: KnownHostEntry[],
  host: string,
  port: number,
  key: Buffer,
): boolean {
  const candidates = hostMatchCandidates(host, port)
  for (const e of entries) {
    const hostHit = e.hostPatterns.some((p) => candidates.includes(p))
    if (!hostHit) continue
    // Compare raw key bytes. ssh2 passes the public-key blob as received
    // during the KEX — identical bytes imply identical keys.
    if (e.keyBytes.equals(key)) return true
  }
  return false
}

/** Produce a short fingerprint for logging: `SHA256:<base64-no-pad>`.
 *  Matches `ssh-keygen -l -E sha256` style. Safe to log — it's a hash
 *  of a public key. */
export function keyFingerprint(key: Buffer): string {
  const b64 = createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
  return `SHA256:${b64}`
}
