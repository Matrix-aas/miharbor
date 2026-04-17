// Client-side mirror of apps/server/src/config/views/tun.ts.
// Kept in sync so the Tun.vue page can derive the typed view from the draft
// document without a server round-trip per keystroke.
//
// When the server projection grows a new field, this file must grow the same
// field. Tests exist on both sides to catch drift.

import type { Document } from 'yaml'
import type { TunConfig, TunStack } from 'miharbor-shared'

const KNOWN_KEYS: ReadonlySet<string> = new Set([
  'enable',
  'device',
  'stack',
  'auto-route',
  'auto-redirect',
  'auto-detect-interface',
  'strict-route',
  'mtu',
  'dns-hijack',
  'route-address',
  'route-exclude-address',
  'inet4-address',
  'inet6-address',
  'interface-name',
  'endpoint-independent-nat',
  'exclude-interface',
])

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

function asBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  return v.map((x) => String(x))
}

function asStack(v: unknown): TunStack | undefined {
  return v === 'system' || v === 'gvisor' || v === 'mixed' ? v : undefined
}

export function getTunConfig(doc: Document): TunConfig {
  const raw = toJSON(doc.getIn(['tun']))
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const rec = raw as Record<string, unknown>
  const out: TunConfig = {}

  const enable = asBool(rec.enable)
  if (enable !== undefined) out.enable = enable
  const device = asString(rec.device)
  if (device !== undefined) out.device = device
  const stack = asStack(rec.stack)
  if (stack !== undefined) out.stack = stack
  const autoRoute = asBool(rec['auto-route'])
  if (autoRoute !== undefined) out['auto-route'] = autoRoute
  const autoRedirect = asBool(rec['auto-redirect'])
  if (autoRedirect !== undefined) out['auto-redirect'] = autoRedirect
  const autoDetect = asBool(rec['auto-detect-interface'])
  if (autoDetect !== undefined) out['auto-detect-interface'] = autoDetect
  const strict = asBool(rec['strict-route'])
  if (strict !== undefined) out['strict-route'] = strict
  const mtu = asNumber(rec.mtu)
  if (mtu !== undefined) out.mtu = mtu
  const hijack = asStringArray(rec['dns-hijack'])
  if (hijack !== undefined) out['dns-hijack'] = hijack
  const routeAddr = asStringArray(rec['route-address'])
  if (routeAddr !== undefined) out['route-address'] = routeAddr
  const routeExcl = asStringArray(rec['route-exclude-address'])
  if (routeExcl !== undefined) out['route-exclude-address'] = routeExcl
  const inet4 = asStringArray(rec['inet4-address'])
  if (inet4 !== undefined) out['inet4-address'] = inet4
  const inet6 = asStringArray(rec['inet6-address'])
  if (inet6 !== undefined) out['inet6-address'] = inet6
  const iface = asString(rec['interface-name'])
  if (iface !== undefined) out['interface-name'] = iface
  const einat = asBool(rec['endpoint-independent-nat'])
  if (einat !== undefined) out['endpoint-independent-nat'] = einat
  const excludeIface = asStringArray(rec['exclude-interface'])
  if (excludeIface !== undefined) out['exclude-interface'] = excludeIface

  const extras: Record<string, unknown> = {}
  let hasExtras = false
  for (const [k, v] of Object.entries(rec)) {
    if (KNOWN_KEYS.has(k)) continue
    extras[k] = v
    hasExtras = true
  }
  if (hasExtras) out.extras = extras

  return out
}
