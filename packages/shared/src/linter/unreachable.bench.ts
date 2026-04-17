// Micro-benchmark for `detectUnreachable`. Not a test — a standalone script
// run via `bun run packages/shared/src/linter/unreachable.bench.ts`. Prints a
// human-readable table of wall-clock timings for various input sizes so we
// can track regressions when the linter is touched.
//
// Fixture mix is representative of real configs: ~50% DOMAIN-SUFFIX (the hot
// path this file optimizes), 25% DOMAIN-KEYWORD (bounded O(k²) subset), 25%
// IP-CIDR (no-op in the linter but counts toward the overall size).

import { detectUnreachable } from './unreachable.ts'
import type { Rule } from '../types/rule.ts'

type IndexedRule = { index: number; rule: Rule }

function makeFixture(n: number): IndexedRule[] {
  const out: IndexedRule[] = []
  const half = Math.floor(n / 2)
  const quarter = Math.floor(n / 4)
  // DOMAIN-SUFFIX — unique per index; ~half of total. Mix of short TLD-like
  // values and longer multi-label values so the trie walk sees varied depths.
  for (let i = 0; i < half; i++) {
    const depth = (i % 3) + 1 // 1..3 labels
    const labels: string[] = []
    for (let d = 0; d < depth; d++) labels.push(`sub${i}_${d}`)
    labels.push(i % 7 === 0 ? 'com' : i % 5 === 0 ? 'ru' : 'example.net')
    out.push({
      index: out.length,
      rule: {
        kind: 'simple',
        type: 'DOMAIN-SUFFIX',
        value: labels.join('.'),
        target: i % 2 === 0 ? 'DIRECT' : 'PROXY',
      },
    })
  }
  // DOMAIN-KEYWORD — quarter of total. Keep these varied so the inner O(k²)
  // check has something to do but stays within the documented budget.
  for (let i = 0; i < quarter; i++) {
    out.push({
      index: out.length,
      rule: {
        kind: 'simple',
        type: 'DOMAIN-KEYWORD',
        value: `kw_${i}_${(i * 31) % 97}`,
        target: i % 2 === 0 ? 'DIRECT' : 'PROXY',
      },
    })
  }
  // IP-CIDR — remainder. Linter currently treats these as pass-through
  // (TODO: subnet containment), so they exercise the no-op fast path.
  while (out.length < n) {
    const i = out.length
    const a = (i * 13) % 256
    const b = (i * 7) % 256
    const prefix = 8 + (i % 16)
    out.push({
      index: out.length,
      rule: {
        kind: 'simple',
        type: 'IP-CIDR',
        value: `${a}.${b}.0.0/${prefix}`,
        target: 'DIRECT',
        modifiers: ['no-resolve'],
      },
    })
  }
  return out
}

function timeOnce(rules: IndexedRule[]): number {
  const t0 = performance.now()
  detectUnreachable(rules)
  return performance.now() - t0
}

function bench(n: number, warmup = 2, runs = 5): { median: number; min: number; max: number } {
  const fixture = makeFixture(n)
  for (let i = 0; i < warmup; i++) detectUnreachable(fixture)
  const samples: number[] = []
  for (let i = 0; i < runs; i++) samples.push(timeOnce(fixture))
  samples.sort((a, b) => a - b)
  const median = samples[Math.floor(samples.length / 2)]!
  return { median, min: samples[0]!, max: samples[samples.length - 1]! }
}

function main() {
  const sizes = [100, 500, 1000, 2000]
  const rows: { n: number; median: number; min: number; max: number }[] = []
  for (const n of sizes) rows.push({ n, ...bench(n) })

  // Print CSV-ish table. Keep column widths reasonable for terminal copy-paste.
  process.stdout.write('n,median_ms,min_ms,max_ms\n')
  for (const r of rows) {
    process.stdout.write(`${r.n},${r.median.toFixed(2)},${r.min.toFixed(2)},${r.max.toFixed(2)}\n`)
  }

  // Human-readable summary.
  process.stdout.write('\n')
  process.stdout.write('| n     | median (ms) | min (ms) | max (ms) |\n')
  process.stdout.write('|------:|------------:|---------:|---------:|\n')
  for (const r of rows) {
    process.stdout.write(
      `| ${String(r.n).padStart(5)} | ${r.median.toFixed(2).padStart(11)} | ${r.min.toFixed(2).padStart(8)} | ${r.max.toFixed(2).padStart(8)} |\n`,
    )
  }
}

main()
