// Proxies view — projects mihomo `proxies:` entries into `ProxyNode` shapes.
// WireGuard nodes get a typed projection; other transport types pass through
// with their extra keys preserved (vmess uuid, ss password+cipher, etc.).
//
// Secret masking (v0.2.4): the `private-key` and `pre-shared-key` fields on
// WireGuard nodes are replaced with FIXED sentinels before leaving the
// server — the pattern pass validation (44 base64 chars) so the client
// form accepts them in its masked-by-default input, but the real key
// material never appears in the JSON response. Operators who want to
// rotate a key type a new value over the sentinel; the deploy pipeline
// substitutes the sentinel back to the current value if it survives into
// the draft unchanged (see apps/server/src/deploy/pipeline.ts).
//
// Other password-shaped fields on non-WireGuard transports (ss.password,
// trojan.password, etc.) ride along on the generic "extra keys" pass-through
// below and are NOT masked in this view — they flow through the SPA's
// unified vault mechanism via /api/config/draft instead. Narrowing the
// read-only-view mask to WG keeps the blast radius of the sentinel-shape
// convention small and auditable.

import type { Document } from 'yaml'
import {
  type ProxyNode,
  type ProxyNodeType,
  type WireGuardNode,
  WIREGUARD_PRE_SHARED_KEY_SENTINEL,
  WIREGUARD_PRIVATE_KEY_SENTINEL,
} from 'miharbor-shared'

const KNOWN_TYPES: ReadonlySet<ProxyNodeType> = new Set([
  'wireguard',
  'ss',
  'vmess',
  'trojan',
  'http',
  'socks5',
  'hysteria2',
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

function asProxyType(v: unknown): ProxyNodeType | null {
  const s = String(v ?? '')
  return KNOWN_TYPES.has(s as ProxyNodeType) ? (s as ProxyNodeType) : null
}

export function getProxies(doc: Document): ProxyNode[] {
  const proxiesNode = doc.getIn(['proxies']) as { items?: unknown[] } | undefined
  if (!proxiesNode || !Array.isArray(proxiesNode.items)) return []

  const out: ProxyNode[] = []
  for (const p of proxiesNode.items) {
    const obj = toJSON(p)
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue
    const rec = obj as Record<string, unknown>
    const type = asProxyType(rec.type)
    if (type === null) continue // unknown transport — skip in view
    const name = String(rec.name ?? '')
    const server = String(rec.server ?? '')
    const port = Number(rec.port ?? 0)
    if (!name || !server || !port) continue
    if (type === 'wireguard') {
      // Mask the real private-key on the way out. Empty/missing → empty
      // string (public view should not imply a key is set when none is).
      const rawPrivateKey = String(rec['private-key'] ?? '')
      const wg: WireGuardNode = {
        name,
        type: 'wireguard',
        server,
        port,
        'private-key': rawPrivateKey.length > 0 ? WIREGUARD_PRIVATE_KEY_SENTINEL : '',
        'public-key': String(rec['public-key'] ?? ''),
        ip: String(rec.ip ?? ''),
      }
      if (typeof rec.udp === 'boolean') wg.udp = rec.udp
      if (typeof rec['pre-shared-key'] === 'string' && rec['pre-shared-key'].length > 0) {
        // Same pattern: sentinel over the real PSK, never the real bytes.
        wg['pre-shared-key'] = WIREGUARD_PRE_SHARED_KEY_SENTINEL
      }
      if (Array.isArray(rec.dns)) wg.dns = rec.dns.map(String)
      if (Array.isArray(rec['allowed-ips']))
        wg['allowed-ips'] = (rec['allowed-ips'] as unknown[]).map(String)
      if (typeof rec['persistent-keepalive'] === 'number') {
        wg['persistent-keepalive'] = rec['persistent-keepalive']
      }
      if (rec['amnezia-wg-option'] && typeof rec['amnezia-wg-option'] === 'object') {
        wg['amnezia-wg-option'] = rec['amnezia-wg-option'] as Record<string, number>
      }
      out.push(wg)
      continue
    }
    // Generic node — preserve the rest of the keys verbatim.
    out.push({
      ...rec,
      name,
      type,
      server,
      port,
    } as ProxyNode)
  }
  return out
}
