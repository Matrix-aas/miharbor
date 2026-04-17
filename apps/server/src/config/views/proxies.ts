// Proxies view — projects mihomo `proxies:` entries into `ProxyNode` shapes.
// WireGuard nodes get a typed projection; other transport types pass through
// with their extra keys preserved (vmess uuid, ss password+cipher, etc.).

import type { Document } from 'yaml'
import type { ProxyNode, ProxyNodeType, WireGuardNode } from 'miharbor-shared'

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
      const wg: WireGuardNode = {
        name,
        type: 'wireguard',
        server,
        port,
        'private-key': String(rec['private-key'] ?? ''),
        'public-key': String(rec['public-key'] ?? ''),
        ip: String(rec.ip ?? ''),
      }
      if (typeof rec.udp === 'boolean') wg.udp = rec.udp
      if (typeof rec['pre-shared-key'] === 'string') wg['pre-shared-key'] = rec['pre-shared-key']
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
