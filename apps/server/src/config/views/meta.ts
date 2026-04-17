// Meta view — top-level scalar settings of a mihomo config (mode, log-level,
// ipv6, external-controller, interface-name, etc.). Used by the UI's
// "Settings" tab and by the universal-invariants linter (Task 7) which needs
// to read e.g. `dns.listen` without parsing the whole doc.
//
// Schema is intentionally loose: mihomo grows new top-level keys over time
// and we don't want to hard-fail on an unknown one. Unknown keys flow through
// in `extras`.

import type { Document } from 'yaml'
import { META_SECRET_SENTINEL } from 'miharbor-shared'

const META_KEYS = [
  'mode',
  'log-level',
  'ipv6',
  'tcp-concurrent',
  'unified-delay',
  'geo-auto-update',
  'geo-update-interval',
  'geodata-mode',
  'external-controller',
  'secret',
  'external-ui',
  'external-ui-url',
  'interface-name',
  'routing-mark',
  'keep-alive-interval',
  'keep-alive-idle',
  'find-process-mode',
  'allow-lan',
  'bind-address',
  'port',
  'socks-port',
  'mixed-port',
  'redir-port',
  'tproxy-port',
] as const

export type MetaKey = (typeof META_KEYS)[number]

export interface ConfigMeta {
  mode?: 'rule' | 'global' | 'direct' | string
  'log-level'?: string
  ipv6?: boolean
  'interface-name'?: string
  'external-controller'?: string
  /** mihomo Bearer token. The `getMeta` projection substitutes the fixed
   *  `META_SECRET_SENTINEL` (from `miharbor-shared`) whenever a real value
   *  is on disk, so the JSON response never carries the raw token. The SPA
   *  is aware of this sentinel (see `ProfileForm.vue`). */
  secret?: string
  'external-ui'?: string
  'external-ui-url'?: string
  'routing-mark'?: number
  'tcp-concurrent'?: boolean
  'unified-delay'?: boolean
  'geo-auto-update'?: boolean
  'geo-update-interval'?: number
  'geodata-mode'?: boolean
  'keep-alive-interval'?: number
  'keep-alive-idle'?: number
  'find-process-mode'?: string
  'allow-lan'?: boolean
  'bind-address'?: string
  port?: number
  'socks-port'?: number
  'mixed-port'?: number
  'redir-port'?: number
  'tproxy-port'?: number

  /** A nested projection of a few sections the universal linter needs. */
  tun?: {
    enable?: boolean
    stack?: string
    device?: string
    'dns-hijack'?: string[]
    'auto-route'?: boolean
    'auto-detect-interface'?: boolean
  }
  dns?: {
    enable?: boolean
    listen?: string
    ipv6?: boolean
    'enhanced-mode'?: string
    'fake-ip-range'?: string
  }
  profile?: {
    'store-selected'?: boolean
    'store-fake-ip'?: boolean
  }
}

function toJSON(node: unknown): unknown {
  if (
    node &&
    typeof node === 'object' &&
    'toJSON' in node &&
    typeof (node as { toJSON: unknown }).toJSON === 'function'
  ) {
    return (node as { toJSON: () => unknown }).toJSON()
  }
  return node
}

function copyKnownKeys<T extends object>(
  src: Record<string, unknown>,
  allowed: readonly string[],
): T {
  const out: Record<string, unknown> = {}
  for (const k of allowed) {
    if (k in src) out[k] = src[k]
  }
  return out as T
}

export function getMeta(doc: Document): ConfigMeta {
  const meta: ConfigMeta = {}
  for (const k of META_KEYS) {
    const v = doc.get(k, true)
    if (v === undefined) continue
    // `.get(key, true)` returns the Node; the actual JS value is on `.value`
    // for scalars; for anything else we deep-serialize.
    const resolved =
      v && typeof v === 'object' && 'value' in (v as Record<string, unknown>)
        ? (v as { value: unknown }).value
        : toJSON(v)
    if (resolved !== undefined && resolved !== null) {
      ;(meta as Record<string, unknown>)[k] = resolved
    }
  }
  // Scrub the Bearer token before the projection leaves the server. Any
  // caller that needs the real value parses the draft YAML (already
  // vault-masked with per-secret UUIDs by /api/config/draft). Using a
  // fixed literal rather than a vault UUID keeps the `/meta` response
  // stable across calls — polling doesn't mint fresh vault entries — and
  // the SPA recognises this sentinel to disable its reveal-eye button.
  if (typeof meta.secret === 'string' && meta.secret.length > 0) {
    meta.secret = META_SECRET_SENTINEL
  }

  const tun = toJSON(doc.getIn(['tun']))
  if (tun && typeof tun === 'object') {
    meta.tun = copyKnownKeys(tun as Record<string, unknown>, [
      'enable',
      'stack',
      'device',
      'dns-hijack',
      'auto-route',
      'auto-detect-interface',
    ])
  }
  const dns = toJSON(doc.getIn(['dns']))
  if (dns && typeof dns === 'object') {
    meta.dns = copyKnownKeys(dns as Record<string, unknown>, [
      'enable',
      'listen',
      'ipv6',
      'enhanced-mode',
      'fake-ip-range',
    ])
  }
  const profile = toJSON(doc.getIn(['profile']))
  if (profile && typeof profile === 'object') {
    meta.profile = copyKnownKeys(profile as Record<string, unknown>, [
      'store-selected',
      'store-fake-ip',
    ])
  }
  return meta
}
