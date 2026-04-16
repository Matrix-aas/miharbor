// AES-256-GCM sentinel vault.
//
// Threat model:
// - Snapshot history is considered low-trust (world-readable in many Docker
//   volume layouts). We never put raw secrets into snapshots.
// - The vault file is written 0600 next to a 0600 key file. If both
//   leak, the attacker has the secrets; this is equivalent to disk
//   compromise — out of scope.
// - AES-256-GCM provides confidentiality + integrity (tamper detection).
//   We do not sign meta.json or snapshot bundles; those are not secret,
//   and corruption is caught at parse time.
//
// On-disk format (`secrets-vault.enc`, binary):
//   [ IV (12 bytes) | AuthTag (16 bytes) | Ciphertext (variable) ]
//   Plaintext is a JSON object:
//     {
//       "version": 1,
//       "entries": {
//         "<uuid>": {
//           "value": "<original-secret>",
//           "created": "<ISO8601>",
//           "referenced_by": ["<snapshot-id>", ...]
//         }, ...
//       }
//     }
//
// Key derivation:
// - `MIHARBOR_VAULT_KEY` ENV (hex, 32 bytes = 64 chars) takes priority.
// - Else, `$DATA_DIR/.vault-key` is read/generated (mode 600).
// - Invalid key → throws `VaultKeyError`.
//
// API invariants:
// - `store(value)` always mints a fresh UUID — idempotence is achieved at
//   mask-time by `walkSecrets`' sentinel-detection, not here.
// - `resolve(uuid)` is side-effect-free. Unknown UUID → null.
// - `maskDoc(doc)` is a structural walk + store-per-secret. For a doc
//   with N secrets, N new UUIDs land in the vault. `gc` reclaims unused
//   UUIDs when the referring snapshot is deleted.
// - `unmaskDoc(doc)` mirrors `maskDoc`: every sentinel in the doc is
//   resolved back to its real value. Missing UUID → throws with a
//   description of which field is affected; the deploy pipeline catches
//   this and surfaces it as "please re-enter secret for N".
// - `gc(referencedUuids)` purges the vault down to the active set.
//   Called by the snapshot manager after retention sweeps.

import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { constants as FS, promises as fsp } from 'node:fs'
import { dirname, join, resolve as pathResolve } from 'node:path'
import type { Document } from 'yaml'
import type { Logger } from '../observability/logger.ts'
import { isSentinel, resolveSecretFields, SENTINEL_PREFIX, walkSecrets } from './mask.ts'
import type { SecretCallback } from './mask.ts'
import { isPair, isScalar, visit } from 'yaml'

const VERSION = 1
const IV_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32

const NOOP_LOGGER: Pick<Logger, 'info' | 'warn' | 'debug' | 'error'> = {
  info: () => {},
  warn: () => {},
  debug: () => {},
  error: () => {},
}

/** Thrown when the key material is missing, wrong length, or malformed. */
export class VaultKeyError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'VaultKeyError'
  }
}

/** Thrown when vault decryption fails — bad key, truncated file, tamper. */
export class VaultCorruptError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'VaultCorruptError'
  }
}

/** Thrown when unmask encounters a sentinel whose uuid is absent. */
export class VaultMissingSecretError extends Error {
  /** The sentinel uuid that could not be resolved. */
  public readonly uuid: string
  /** A human path into the YAML doc, for UI messages (best-effort). */
  public readonly fieldPath: string | null
  constructor(uuid: string, fieldPath: string | null) {
    super(`vault: cannot resolve sentinel ${uuid}` + (fieldPath ? ` at path ${fieldPath}` : ''))
    this.name = 'VaultMissingSecretError'
    this.uuid = uuid
    this.fieldPath = fieldPath
  }
}

interface VaultEntry {
  value: string
  created: string
  referenced_by: string[]
}

interface VaultPayload {
  version: number
  entries: Record<string, VaultEntry>
}

export interface VaultOptions {
  /** Miharbor data directory (vault + .vault-key live here). */
  dataDir: string
  /** Raw ENV value of `MIHARBOR_VAULT_KEY` (hex, 64 chars). Empty string
   *  falls back to file-on-disk key. */
  vaultKeyEnv?: string
  /** Comma-separated ENV value of `MIHARBOR_SECRET_FIELDS` (additions to
   *  the default list). */
  secretFieldsEnv?: string
  /** Optional logger; defaults to a no-op shim. */
  logger?: Pick<Logger, 'info' | 'warn' | 'debug' | 'error'>
}

export interface Vault {
  /** Store `value` in the vault; returns the uuid (NO sentinel prefix). */
  store(value: string): Promise<string>
  /** Resolve `uuid` to the original value, or null if unknown. */
  resolve(uuid: string): Promise<string | null>
  /** In-place mask: every secret scalar is registered + replaced with a
   *  sentinel. Safe to run on a doc that's already (partially) masked —
   *  existing sentinels are preserved. Returns the set of uuids minted
   *  during this call. */
  maskDoc(doc: Document, snapshotId?: string): Promise<string[]>
  /** In-place unmask: every sentinel scalar is looked up and restored. */
  unmaskDoc(doc: Document): Promise<void>
  /** Drop every uuid not in `referencedUuids`. Returns the count removed. */
  gc(referencedUuids: Set<string>): Promise<number>
  /** Rewrite the `referenced_by` list for a given snapshot id, adding the
   *  supplied uuid set. Useful for the snapshot manager to bookkeep which
   *  snapshots touched which secrets. */
  addReferences(snapshotId: string, uuids: Iterable<string>): Promise<void>
  /** Remove all bookkeeping for a snapshot id (called on snapshot delete). */
  dropSnapshotReferences(snapshotId: string): Promise<void>
}

/** Factory: produces a cached Vault bound to the given data dir. Call
 *  `createVault` once per process. Subsequent calls within a single
 *  process are safe (each call reads the on-disk file fresh). */
export async function createVault(opts: VaultOptions): Promise<Vault> {
  const logger = opts.logger ?? NOOP_LOGGER
  const dataDir = pathResolve(opts.dataDir)
  await fsp.mkdir(dataDir, { recursive: true, mode: 0o700 })
  const vaultPath = join(dataDir, 'secrets-vault.enc')
  const keyPath = join(dataDir, '.vault-key')
  const fields = resolveSecretFields(opts.secretFieldsEnv)
  const key = await loadOrGenerateKey(keyPath, opts.vaultKeyEnv, logger)

  /** Read+decrypt the vault (or return empty payload if file absent). */
  async function readPayload(): Promise<VaultPayload> {
    if (!(await fileExists(vaultPath))) {
      return { version: VERSION, entries: {} }
    }
    const buf = await fsp.readFile(vaultPath)
    if (buf.length < IV_LEN + TAG_LEN) {
      throw new VaultCorruptError(
        `vault file ${vaultPath} truncated (${buf.length} bytes; minimum ${IV_LEN + TAG_LEN})`,
      )
    }
    const iv = buf.subarray(0, IV_LEN)
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN)
    const ciphertext = buf.subarray(IV_LEN + TAG_LEN)
    let decrypted: Buffer
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(tag)
      decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    } catch (e) {
      throw new VaultCorruptError(
        `vault decryption failed (${(e as Error).message}); wrong key or tampered file`,
      )
    }
    let parsed: VaultPayload
    try {
      parsed = JSON.parse(decrypted.toString('utf8')) as VaultPayload
    } catch (e) {
      throw new VaultCorruptError(`vault JSON parse failed: ${(e as Error).message}`)
    }
    if (parsed.version !== VERSION) {
      throw new VaultCorruptError(
        `vault version mismatch: expected ${VERSION}, got ${parsed.version}`,
      )
    }
    return parsed
  }

  /** Encrypt+atomic-write the payload. */
  async function writePayload(payload: VaultPayload): Promise<void> {
    const iv = randomBytes(IV_LEN)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const tag = cipher.getAuthTag()
    const combined = Buffer.concat([iv, tag, ciphertext])
    await atomicWriteBinary(vaultPath, combined, 0o600)
  }

  const vault: Vault = {
    async store(value) {
      const payload = await readPayload()
      const uuid = randomUUID()
      payload.entries[uuid] = {
        value,
        created: new Date().toISOString(),
        referenced_by: [],
      }
      await writePayload(payload)
      return uuid
    },

    async resolve(uuid) {
      const payload = await readPayload()
      const entry = payload.entries[uuid]
      return entry ? entry.value : null
    },

    async maskDoc(doc, snapshotId) {
      const payload = await readPayload()
      const minted: string[] = []
      const cb: SecretCallback = (currentValue) => {
        const uuid = randomUUID()
        payload.entries[uuid] = {
          value: currentValue,
          created: new Date().toISOString(),
          referenced_by: snapshotId ? [snapshotId] : [],
        }
        minted.push(uuid)
        return SENTINEL_PREFIX + uuid
      }
      walkSecrets(doc, fields, cb)
      await writePayload(payload)
      return minted
    },

    async unmaskDoc(doc) {
      const payload = await readPayload()
      // Walk and replace every sentinel scalar.
      let error: VaultMissingSecretError | null = null
      visit(doc, {
        Pair(_k, pair) {
          if (error) return visit.BREAK
          if (!isPair(pair)) return
          if (!isScalar(pair.key) || !isScalar(pair.value)) return
          const v = pair.value.value
          if (typeof v !== 'string' || !isSentinel(v)) return
          const uuid = v.slice(SENTINEL_PREFIX.length)
          const entry = payload.entries[uuid]
          if (!entry) {
            const keyStr =
              typeof pair.key.value === 'string' ? pair.key.value : String(pair.key.value)
            error = new VaultMissingSecretError(uuid, keyStr)
            return visit.BREAK
          }
          pair.value.value = entry.value
          return
        },
      })
      if (error) throw error
    },

    async gc(referencedUuids) {
      const payload = await readPayload()
      let removed = 0
      for (const uuid of Object.keys(payload.entries)) {
        if (!referencedUuids.has(uuid)) {
          delete payload.entries[uuid]
          removed += 1
        }
      }
      if (removed > 0) await writePayload(payload)
      return removed
    },

    async addReferences(snapshotId, uuids) {
      const payload = await readPayload()
      let changed = false
      for (const uuid of uuids) {
        const entry = payload.entries[uuid]
        if (!entry) continue
        if (!entry.referenced_by.includes(snapshotId)) {
          entry.referenced_by.push(snapshotId)
          changed = true
        }
      }
      if (changed) await writePayload(payload)
    },

    async dropSnapshotReferences(snapshotId) {
      const payload = await readPayload()
      let changed = false
      for (const entry of Object.values(payload.entries)) {
        const idx = entry.referenced_by.indexOf(snapshotId)
        if (idx !== -1) {
          entry.referenced_by.splice(idx, 1)
          changed = true
        }
      }
      if (changed) await writePayload(payload)
    },
  }
  return vault
}

// ---------- helpers (not exported) ----------

async function fileExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p, FS.F_OK)
    return true
  } catch {
    return false
  }
}

/** Write `buf` atomically (tmp-sibling + rename) with the given mode. */
async function atomicWriteBinary(target: string, buf: Buffer, mode: number): Promise<void> {
  const dir = dirname(target)
  const tmp = join(dir, `.${randomUUID()}.miharbor.vault.tmp`)
  const fh = await fsp.open(tmp, 'w', mode)
  try {
    await fh.writeFile(buf)
    await fh.sync()
  } finally {
    await fh.close()
  }
  await fsp.rename(tmp, target)
  try {
    await fsp.chmod(target, mode)
  } catch {
    /* non-fatal — same rationale as local-fs.ts */
  }
}

/** Parse a 32-byte hex key from `hex` — throws VaultKeyError on bad shape. */
function parseHexKey(hex: string): Buffer {
  const clean = hex.trim()
  if (clean.length !== KEY_LEN * 2) {
    throw new VaultKeyError(`vault key must be ${KEY_LEN * 2} hex chars (got ${clean.length})`)
  }
  if (!/^[0-9a-fA-F]+$/.test(clean)) {
    throw new VaultKeyError('vault key contains non-hex characters')
  }
  return Buffer.from(clean, 'hex')
}

/** Resolve the AES key: ENV takes priority; fall back to `.vault-key`
 *  (generate on first run with a WARN log). */
async function loadOrGenerateKey(
  keyPath: string,
  envValue: string | undefined,
  logger: Pick<Logger, 'info' | 'warn' | 'debug' | 'error'>,
): Promise<Buffer> {
  if (envValue && envValue.length > 0) {
    return parseHexKey(envValue)
  }
  if (await fileExists(keyPath)) {
    const contents = await fsp.readFile(keyPath, 'utf8')
    return parseHexKey(contents)
  }
  const fresh = randomBytes(KEY_LEN)
  const hex = fresh.toString('hex') + '\n'
  await atomicWriteBinary(keyPath, Buffer.from(hex, 'utf8'), 0o600)
  logger.warn({
    msg: 'generated new vault key',
    path: keyPath,
    note: 'backup obligatory — losing this key invalidates every snapshot',
    category: 'vault',
  })
  return fresh
}

/** Re-exported so callers don't need to know about mask.ts for the common
 *  "is this value a sentinel" predicate. */
export { isSecretKey, isSentinel, SENTINEL_PREFIX, resolveSecretFields } from './mask.ts'
