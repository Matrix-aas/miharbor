// ProxyNode — a mihomo `proxies:` entry. WireGuard has a richer, typed shape;
// other node types are treated loosely (typed base + pass-through keys) to
// avoid hard-coding every transport.

export type ProxyNodeType =
  | 'wireguard'
  | 'ss'
  | 'vmess'
  | 'trojan'
  | 'http'
  | 'socks5'
  | 'hysteria2'

export interface ProxyNodeBase {
  name: string
  type: ProxyNodeType
  server: string
  port: number
  udp?: boolean
}

export interface WireGuardNode extends ProxyNodeBase {
  type: 'wireguard'
  'private-key': string
  'public-key': string
  'pre-shared-key'?: string
  ip: string
  dns?: string[]
  'allowed-ips'?: string[]
  'persistent-keepalive'?: number
  'amnezia-wg-option'?: Record<string, number>
}

export type ProxyNode =
  | WireGuardNode
  | (ProxyNodeBase & {
      type: Exclude<ProxyNodeType, 'wireguard'>
      [k: string]: unknown
    })
