// CIDR allowlist evaluator for `MIHARBOR_TRUSTED_PROXY_CIDRS`. Used by the
// Basic-Auth middleware to decide whether to trust a
// `MIHARBOR_TRUST_PROXY_HEADER`-named header (typically `X-Forwarded-User`)
// for bypassing auth.
//
// We intentionally avoid pulling in a dependency like `ip-range-check` or
// `netmask`. The CIDR set is tiny (operator's own reverse-proxy list, usually
// 1–3 entries) and only needs exact subnet-containment for IPv4 + IPv6.
//
// Design:
//  - Parse CIDR strings once at startup into a compiled list.
//  - `contains(ip)` converts the candidate to a BigInt and runs a linear
//    scan (O(N) for tiny N).
//  - Invalid CIDR entries log a warning and are skipped; we don't fail
//    bootstrap on a typo.

export interface CompiledCidr {
  version: 4 | 6
  /** Network bits as a BigInt, already masked. */
  network: bigint
  /** Mask as a BigInt (all-ones over the network portion). */
  mask: bigint
  /** Original string for diagnostics. */
  raw: string
}

export interface TrustProxyEvaluator {
  contains(ip: string): boolean
  cidrs(): CompiledCidr[]
}

/** Parse a comma-separated CIDR list. Bad entries are dropped + reported
 *  via `onInvalid` (defaults to silently dropping). */
export function parseCidrList(
  list: string,
  onInvalid?: (raw: string, reason: string) => void,
): CompiledCidr[] {
  const out: CompiledCidr[] = []
  for (const raw of list.split(',')) {
    const t = raw.trim()
    if (!t) continue
    try {
      out.push(parseCidr(t))
    } catch (e) {
      onInvalid?.(t, (e as Error).message)
    }
  }
  return out
}

export function parseCidr(raw: string): CompiledCidr {
  const [addrPart, bitsStr] = raw.includes('/') ? raw.split('/', 2) : [raw, undefined]
  if (!addrPart) throw new Error(`empty CIDR`)
  const version = isIPv6(addrPart) ? 6 : 4
  const maxBits = version === 4 ? 32 : 128
  const bits = bitsStr === undefined ? maxBits : Number(bitsStr)
  if (!Number.isInteger(bits) || bits < 0 || bits > maxBits) {
    throw new Error(`CIDR prefix ${bitsStr} out of range for IPv${version}`)
  }
  const addrBI = ipToBigInt(addrPart, version)
  const mask = bits === 0 ? 0n : (~0n << BigInt(maxBits - bits)) & maskAll(maxBits)
  return { version, network: addrBI & mask, mask, raw }
}

export function createTrustProxyEvaluator(
  cidrCsv: string,
  onInvalid?: (raw: string, reason: string) => void,
): TrustProxyEvaluator {
  const compiled = parseCidrList(cidrCsv, onInvalid)
  return {
    contains(ip: string): boolean {
      let version: 4 | 6
      try {
        version = isIPv6(ip) ? 6 : 4
      } catch {
        return false
      }
      let addr: bigint
      try {
        addr = ipToBigInt(ip, version)
      } catch {
        return false
      }
      for (const c of compiled) {
        if (c.version !== version) continue
        if ((addr & c.mask) === c.network) return true
      }
      return false
    },
    cidrs() {
      return compiled
    },
  }
}

// ---------- helpers ----------

function maskAll(bits: number): bigint {
  return (1n << BigInt(bits)) - 1n
}

export function isIPv6(addr: string): boolean {
  // Very permissive heuristic: IPv6 has at least one `:`; IPv4 has dots only.
  // Does not validate — `ipToBigInt` handles strict parsing.
  return addr.includes(':')
}

export function ipToBigInt(addr: string, version: 4 | 6): bigint {
  if (version === 4) {
    const parts = addr.split('.')
    if (parts.length !== 4) throw new Error(`invalid IPv4: ${addr}`)
    let r = 0n
    for (const p of parts) {
      const n = Number(p)
      if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error(`invalid IPv4 octet: ${p}`)
      r = (r << 8n) | BigInt(n)
    }
    return r
  }
  // IPv6 with optional :: shortcut.
  let expanded = addr
  if (addr.includes('::')) {
    const [left, right] = addr.split('::', 2)
    const lParts = left ? left.split(':') : []
    const rParts = right ? right.split(':') : []
    const need = 8 - (lParts.length + rParts.length)
    if (need < 0) throw new Error(`invalid IPv6 (too many groups): ${addr}`)
    const zeros = Array(need).fill('0')
    expanded = [...lParts, ...zeros, ...rParts].join(':')
  }
  const parts = expanded.split(':')
  if (parts.length !== 8) throw new Error(`invalid IPv6: ${addr}`)
  let r = 0n
  for (const p of parts) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(p)) throw new Error(`invalid IPv6 group: ${p}`)
    r = (r << 16n) | BigInt(parseInt(p, 16))
  }
  return r
}
