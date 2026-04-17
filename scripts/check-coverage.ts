#!/usr/bin/env bun
/**
 * Coverage gate: parses bun test --coverage output and enforces threshold.
 *
 * Usage:
 *   bun run scripts/check-coverage.ts
 *
 * Reads coverage report from stdout of `bun test --coverage` and checks:
 *   1. apps/server/src/ overall line coverage >= 80%
 *   2. No regression from baseline (stored in .coverage-exclusions.json)
 *
 * Exit codes:
 *   0 = pass
 *   1 = fail (threshold not met or regression detected)
 */

import { spawn } from 'bun'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const COVERAGE_THRESHOLD = 80
const BASELINE_FILE = '.coverage-exclusions.json'

interface CoverageBaseline {
  overall_coverage: {
    apps_server_src: number
    threshold: number
  }
}

function extractCoverageFromOutput(output: string): {
  overall: number
  files: Map<string, number>
} {
  const files = new Map<string, number>()
  const lines = output.split('\n')

  // Find the "All files" line
  for (const line of lines) {
    if (line.includes('All files')) {
      // Parse: "All files                                           |   88.33 |   91.17 |"
      // We want the line coverage (second number)
      const match = line.match(/\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|/)
      if (match) {
        const overall = parseFloat(match[2])
        return { overall, files }
      }
    }
    // Parse individual file lines under apps/server/src/
    if (line.includes('apps/server/src/')) {
      const match = line.match(/apps\/server\/src\/.*?\s+\|\s+[\d.]+\s+\|\s+([\d.]+)\s+\|/)
      if (match) {
        const fileCoverage = parseFloat(match[1])
        const fileNameMatch = line.match(/(apps\/server\/src\/\S+)/)
        if (fileNameMatch) {
          files.set(fileNameMatch[1], fileCoverage)
        }
      }
    }
  }

  return { overall: 0, files }
}

async function runCoverageTest(): Promise<string> {
  let output = ''
  let error = ''

  const proc = Bun.spawn(['bun', 'test', '--coverage'], {
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const stdoutText = await new Response(proc.stdout).text()
  const stderrText = await new Response(proc.stderr).text()

  return stdoutText + stderrText
}

function loadBaseline(): CoverageBaseline | null {
  try {
    const content = readFileSync(BASELINE_FILE, 'utf8')
    return JSON.parse(content) as CoverageBaseline
  } catch {
    return null
  }
}

function checkCoverage(overall: number, baseline: CoverageBaseline | null): boolean {
  const threshold = baseline?.overall_coverage.threshold ?? COVERAGE_THRESHOLD

  console.log(`\n📊 Coverage Check`)
  console.log(`   Threshold: ${threshold}%`)
  console.log(`   Current:   ${overall.toFixed(2)}%`)

  if (overall < threshold) {
    console.error(`\n❌ FAIL: Coverage ${overall.toFixed(2)}% is below threshold ${threshold}%`)
    return false
  }

  // Check for regression
  if (baseline) {
    const baselineCoverage = baseline.overall_coverage.apps_server_src
    if (overall < baselineCoverage - 1) {
      // Allow 1% variance
      console.error(
        `\n❌ REGRESSION: Coverage dropped from ${baselineCoverage.toFixed(2)}% to ${overall.toFixed(2)}%`,
      )
      return false
    }
  }

  console.log(`\n✅ PASS: Coverage meets threshold`)
  return true
}

async function main() {
  const baseline = loadBaseline()
  console.log('🏃 Running coverage test...')
  const output = await runCoverageTest()
  const { overall } = extractCoverageFromOutput(output)

  if (overall === 0) {
    console.error('❌ Failed to parse coverage output')
    process.exit(1)
  }

  const passed = checkCoverage(overall, baseline)

  if (!passed) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
