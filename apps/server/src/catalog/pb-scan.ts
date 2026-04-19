// Minimal protobuf scanner for V2Ray/mihomo `.dat` files.
//
// Schema (from v2fly/v2ray-core `app/router/config.proto`):
//
//   message GeoIPList     { repeated GeoIP     entry = 1; }
//   message SiteGroupList { repeated SiteGroup entry = 1; }
//
//   message GeoIP     { string country_code = 1; repeated CIDR   cidr   = 2; }
//   message SiteGroup { string country_code = 1; repeated Domain domain = 2; }
//
// We only need the `country_code` strings. The scanner walks the top-level
// `entry` (field 1, wire type 2 = length-delimited) repeated, and inside each
// nested message finds the first field 1 of wire type 2, reads the UTF-8
// string, and skips everything else. Unknown fields and entries missing
// field 1 are tolerated — we never throw.
//
// Wire-format recap:
//
//   tag = (field_number << 3) | wire_type
//   wire_type 0 = varint        (skip by reading varint)
//   wire_type 1 = 64-bit fixed  (skip 8 bytes)
//   wire_type 2 = length-delim  (read varint length, then skip bytes)
//   wire_type 5 = 32-bit fixed  (skip 4 bytes)
//
// First 32 bytes of a typical geoip.dat (3 entries):
//
//   0A [len-of-entry-1] 0A [len-name-1] <name bytes> <skipped fields> ...
//   0A [len-of-entry-2] ...

export function pbScan(buf: Uint8Array): string[] {
  const out: string[] = []
  const r = new Reader(buf)
  while (r.hasMore()) {
    const tag = r.readVarint()
    const field = Number(tag >> 3n)
    const wire = Number(tag & 0x7n)
    if (field === 1 && wire === 2) {
      const len = Number(r.readVarint())
      const inner = r.readBytes(len)
      const name = scanInnerCountryCode(inner)
      if (name !== null) out.push(name)
    } else {
      skipField(r, wire)
    }
  }
  return out
}

function scanInnerCountryCode(buf: Uint8Array): string | null {
  const r = new Reader(buf)
  while (r.hasMore()) {
    const tag = r.readVarint()
    const field = Number(tag >> 3n)
    const wire = Number(tag & 0x7n)
    if (field === 1 && wire === 2) {
      const len = Number(r.readVarint())
      const bytes = r.readBytes(len)
      return new TextDecoder('utf-8').decode(bytes)
    }
    skipField(r, wire)
  }
  return null
}

function skipField(r: Reader, wire: number): void {
  switch (wire) {
    case 0: // varint
      r.readVarint()
      return
    case 1: // 64-bit
      r.readBytes(8)
      return
    case 2: // length-delim
      {
        const len = Number(r.readVarint())
        r.readBytes(len)
      }
      return
    case 5: // 32-bit
      r.readBytes(4)
      return
    default:
      // Unknown wire type — bail out by consuming everything so we don't loop.
      r.finish()
      return
  }
}

class Reader {
  private pos = 0
  constructor(private readonly buf: Uint8Array) {}

  hasMore(): boolean {
    return this.pos < this.buf.length
  }

  finish(): void {
    this.pos = this.buf.length
  }

  readVarint(): bigint {
    let result = 0n
    let shift = 0n
    // protobuf varints are at most 10 bytes (64-bit ints).
    for (let i = 0; i < 10; i++) {
      if (this.pos >= this.buf.length) {
        // Truncated varint — treat as end of stream.
        return result
      }
      const b = this.buf[this.pos]!
      this.pos += 1
      result |= BigInt(b & 0x7f) << shift
      if ((b & 0x80) === 0) return result
      shift += 7n
    }
    return result
  }

  readBytes(n: number): Uint8Array {
    const end = Math.min(this.pos + n, this.buf.length)
    const out = this.buf.subarray(this.pos, end)
    this.pos = end
    return out
  }
}
