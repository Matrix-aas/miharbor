import { describe, expect, it } from 'bun:test'
import { pbScan } from '../../src/catalog/pb-scan.ts'
import { buildTinyDat } from './fixtures/build-fixture.ts'

describe('pbScan', () => {
  it('returns empty array for empty buffer', () => {
    expect(pbScan(new Uint8Array(0))).toEqual([])
  })

  it('extracts country_code names in file order', () => {
    const bytes = buildTinyDat(['test-alpha', 'test-beta', 'test-gamma'])
    expect(pbScan(bytes)).toEqual(['test-alpha', 'test-beta', 'test-gamma'])
  })

  it('preserves duplicates', () => {
    const bytes = buildTinyDat(['ru', 'ru', 'cn'])
    expect(pbScan(bytes)).toEqual(['ru', 'ru', 'cn'])
  })

  it('handles a 128-entry buffer (varint boundary)', () => {
    const names = Array.from({ length: 128 }, (_, i) => `c${i}`)
    const bytes = buildTinyDat(names)
    expect(pbScan(bytes)).toEqual(names)
  })

  it('skips entries that lack country_code (field 1)', () => {
    // Build a buffer by hand: one valid entry, one entry with field 2 only.
    const encoder = new TextEncoder()
    const validInner: number[] = []
    // tag (1<<3 | 2) = 0x0a, length 3, bytes 'ok'
    validInner.push(0x0a, 3, ...encoder.encode('ok1'))
    // Skipping entry: tag (2<<3 | 2) = 0x12, length 3, bytes 'xx'
    const skipInner: number[] = [0x12, 3, 0x78, 0x78, 0x78]
    const top: number[] = []
    // Wrap valid inner in top-level field 1
    top.push(0x0a, validInner.length, ...validInner)
    // Wrap skip inner in top-level field 1
    top.push(0x0a, skipInner.length, ...skipInner)
    const names = pbScan(new Uint8Array(top))
    expect(names).toEqual(['ok1'])
  })

  it('tolerates unknown wire types 0, 1, 5 inside entry via skipField', () => {
    // Build one entry whose FIRST field is a varint (wire type 0) — scanner
    // must skip it and continue; then comes the string (field 1, wire 2).
    // We use a different field number for the varint so it doesn't collide.
    const encoder = new TextEncoder()
    const inner: number[] = []
    // tag (5<<3 | 0) = 0x28, varint 42
    inner.push(0x28, 42)
    // tag (7<<3 | 1) = 0x39, 8 bytes of zeros (wire type 1 = 64-bit)
    inner.push(0x39, 0, 0, 0, 0, 0, 0, 0, 0)
    // tag (8<<3 | 5) = 0x45, 4 bytes (wire type 5 = 32-bit)
    inner.push(0x45, 0, 0, 0, 0)
    // Now the real country_code — tag (1<<3 | 2) = 0x0a
    inner.push(0x0a, 3, ...encoder.encode('ok2'))
    const top: number[] = [0x0a, inner.length, ...inner]
    expect(pbScan(new Uint8Array(top))).toEqual(['ok2'])
  })
})
