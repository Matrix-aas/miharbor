// ProxyNode — a mihomo `proxies:` entry. WireGuard has a richer, typed shape;
// other node types are treated loosely (typed base + pass-through keys) to
// avoid hard-coding every transport.

import { Type } from '@sinclair/typebox'

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

// --- TypeBox schemas (I7) -------------------------------------------------
// WireGuard has a precise shape we can validate. Other transports are accepted
// as a typed base with unknown pass-through keys (`additionalProperties`).

export const ProxyNodeTypeSchema = Type.Union([
  Type.Literal('wireguard'),
  Type.Literal('ss'),
  Type.Literal('vmess'),
  Type.Literal('trojan'),
  Type.Literal('http'),
  Type.Literal('socks5'),
  Type.Literal('hysteria2'),
])

export const WireGuardNodeSchema = Type.Object({
  name: Type.String(),
  type: Type.Literal('wireguard'),
  server: Type.String(),
  port: Type.Integer({ minimum: 1, maximum: 65535 }),
  udp: Type.Optional(Type.Boolean()),
  'private-key': Type.String(),
  'public-key': Type.String(),
  'pre-shared-key': Type.Optional(Type.String()),
  ip: Type.String(),
  dns: Type.Optional(Type.Array(Type.String())),
  'allowed-ips': Type.Optional(Type.Array(Type.String())),
  'persistent-keepalive': Type.Optional(Type.Integer()),
  'amnezia-wg-option': Type.Optional(Type.Record(Type.String(), Type.Number())),
})

// Generic (non-WireGuard) shape — strict about base fields, loose about extras
// to avoid encoding every transport's knobs here.
export const GenericProxyNodeSchema = Type.Object(
  {
    name: Type.String(),
    type: Type.Union([
      Type.Literal('ss'),
      Type.Literal('vmess'),
      Type.Literal('trojan'),
      Type.Literal('http'),
      Type.Literal('socks5'),
      Type.Literal('hysteria2'),
    ]),
    server: Type.String(),
    port: Type.Integer({ minimum: 1, maximum: 65535 }),
    udp: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: true },
)

export const ProxyNodeSchema = Type.Union([WireGuardNodeSchema, GenericProxyNodeSchema])
