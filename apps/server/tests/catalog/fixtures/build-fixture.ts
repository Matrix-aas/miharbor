// Synthetic `.dat` writer — emits a V2Ray-compatible GeoIPList/SiteGroupList
// protobuf with N top-level entries. Each entry carries only `country_code`
// (field 1, wire type 2). CIDRs / domains (field 2, wire type 2) are
// intentionally omitted — the scanner must tolerate missing field 2.
//
// protobuf wire format recap:
//   tag = (field_number << 3) | wire_type
//   wire_type 0 = varint
//   wire_type 2 = length-delimited (varint length prefix + bytes)
//
// Top-level list has field 1 (entry) repeated. Each entry is a nested
// message whose field 1 (country_code) is the string we want to read.

function writeVarint(n: number, out: number[]): void {
  let v = n
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80)
    v >>>= 7
  }
  out.push(v & 0x7f)
}

function writeString(bytes: number[], fieldNumber: number, value: string): void {
  const encoded = new TextEncoder().encode(value)
  const tag = (fieldNumber << 3) | 2
  writeVarint(tag, bytes)
  writeVarint(encoded.length, bytes)
  for (const b of encoded) bytes.push(b)
}

function writeSubMessage(bytes: number[], fieldNumber: number, inner: number[]): void {
  const tag = (fieldNumber << 3) | 2
  writeVarint(tag, bytes)
  writeVarint(inner.length, bytes)
  for (const b of inner) bytes.push(b)
}

/** Build a `.dat` file with N top-level entries, each carrying just a
 *  `country_code` (field 1). Names are the given list. Returns Uint8Array
 *  ready to write to disk. */
export function buildTinyDat(names: string[]): Uint8Array {
  const top: number[] = []
  for (const name of names) {
    const inner: number[] = []
    writeString(inner, 1, name)
    writeSubMessage(top, 1, inner)
  }
  return new Uint8Array(top)
}
