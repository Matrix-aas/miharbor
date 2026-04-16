import { expect, test } from 'bun:test'
import { applyRetention } from '../../src/deploy/retention.ts'
import type { SnapshotMeta } from '../../src/transport/transport.ts'

function meta(id: string, timestamp: string): SnapshotMeta {
  return {
    id,
    timestamp,
    sha256_original: 'a'.repeat(64),
    sha256_masked: 'b'.repeat(64),
    applied_by: 'user',
    transport: 'local',
  }
}

test('keeps everything when both COUNT and DAYS bounds are generous', () => {
  const snapshots = [
    meta('0', '2026-04-16T12:00:00.000Z'),
    meta('1', '2026-04-16T11:00:00.000Z'),
    meta('2', '2026-04-16T10:00:00.000Z'),
  ]
  const now = Date.parse('2026-04-16T13:00:00.000Z')
  const r = applyRetention(snapshots, { retentionCount: 50, retentionDays: 30 }, now)
  expect(r.keep).toEqual(['0', '1', '2'])
  expect(r.remove).toEqual([])
})

test('removes snapshots that are both too old AND past the count bound', () => {
  // 3 snapshots, count bound = 1, day bound = 7. Snap 0 is recent → kept.
  // Snap 1 is older than 7d → age fails, but index 1 < 2? if count=2. With
  // count=1, only index 0 passes count. Snap 1 is 10 days old → age fails.
  // Snap 2 is 20 days old → age fails. Both should be removed.
  const now = Date.parse('2026-04-16T12:00:00.000Z')
  const d = 24 * 60 * 60 * 1000
  const snapshots = [
    meta('recent', new Date(now - 0.5 * d).toISOString()),
    meta('ten-days-old', new Date(now - 10 * d).toISOString()),
    meta('twenty-days-old', new Date(now - 20 * d).toISOString()),
  ]
  const r = applyRetention(snapshots, { retentionCount: 1, retentionDays: 7 }, now)
  expect(r.keep).toEqual(['recent'])
  expect(r.remove).toEqual(['ten-days-old', 'twenty-days-old'])
})

test('keeps old snapshots if they fall under the count bound', () => {
  // Even if 100 days old, index 0 survives because count=1 > 0.
  const now = Date.parse('2026-04-16T12:00:00.000Z')
  const d = 24 * 60 * 60 * 1000
  const snapshots = [meta('ancient', new Date(now - 100 * d).toISOString())]
  const r = applyRetention(snapshots, { retentionCount: 1, retentionDays: 7 }, now)
  expect(r.keep).toEqual(['ancient'])
  expect(r.remove).toEqual([])
})

test('keeps recent snapshots even if they exceed the count bound', () => {
  // Count=1 would limit to 1, but all are within the day window → all kept.
  const now = Date.parse('2026-04-16T12:00:00.000Z')
  const h = 60 * 60 * 1000
  const snapshots = [
    meta('a', new Date(now - 1 * h).toISOString()),
    meta('b', new Date(now - 2 * h).toISOString()),
    meta('c', new Date(now - 3 * h).toISOString()),
  ]
  const r = applyRetention(snapshots, { retentionCount: 1, retentionDays: 7 }, now)
  expect(r.keep).toEqual(['a', 'b', 'c'])
  expect(r.remove).toEqual([])
})

test('handles unparseable timestamps by keeping (fail-safe)', () => {
  const now = Date.parse('2026-04-16T12:00:00.000Z')
  const snapshots = [
    meta('broken', 'definitely-not-a-date'),
    meta('ok', new Date(now - 1000).toISOString()),
  ]
  const r = applyRetention(snapshots, { retentionCount: 0, retentionDays: 0 }, now)
  // broken timestamp → keep (defensive); ok is 1 sec old, days=0 cutoff
  // so age fails, count=0 so index 1 also fails → removed.
  expect(r.keep).toContain('broken')
})

test('spec default formula: count=50, days=30 with 60 snapshots over 45 days', () => {
  const now = Date.parse('2026-04-16T12:00:00.000Z')
  const d = 24 * 60 * 60 * 1000
  const snapshots: SnapshotMeta[] = []
  // 60 snapshots, one every 0.75 days = ~45-day span.
  for (let i = 0; i < 60; i += 1) {
    snapshots.push(meta(`s-${i}`, new Date(now - i * 0.75 * d).toISOString()))
  }
  const r = applyRetention(snapshots, { retentionCount: 50, retentionDays: 30 }, now)
  // First 50 are kept by count. Index 50-59 are 37.5-44.25 days old → past
  // 30 days AND past count=50, so removed.
  expect(r.keep.length).toBe(50)
  expect(r.remove.length).toBe(10)
  expect(r.remove[0]).toBe('s-50')
})

test('empty list returns empty decision', () => {
  const r = applyRetention([], { retentionCount: 50, retentionDays: 30 })
  expect(r.keep).toEqual([])
  expect(r.remove).toEqual([])
})
