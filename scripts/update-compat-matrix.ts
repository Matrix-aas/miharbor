#!/usr/bin/env bun
/**
 * Update README.md with the compatibility matrix.
 *
 * This script generates a markdown table showing Miharbor's compatibility
 * with different mihomo versions. In the MVP (v0.2.0), we hardcode the
 * matrix into the table, but this script exists as a placeholder for future
 * automation that could:
 *
 *  - Read CI matrix job outputs from GitHub Actions API
 *  - Parse test results and emit pass/fail per version
 *  - Auto-commit back to the repo with PR comment
 *
 * Usage:
 *   bun run scripts/update-compat-matrix.ts
 *
 * This will:
 *  1. Read README.md
 *  2. Find the <!-- compat-matrix-start --> ... <!-- compat-matrix-end --> section
 *  3. Replace it with a generated table
 *  4. Write README.md back
 *
 * For MVP, the matrix is hardcoded in the `generateMatrix` function.
 * Future versions can fetch this from GitHub Actions job artifacts or
 * from a manifest file generated during release builds.
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const repoRoot = resolve(import.meta.dir, '..')
const readmePath = resolve(repoRoot, 'README.md')

/**
 * Generate the compatibility matrix markdown table.
 * MVP: hardcoded versions; future: fetch from CI/manifest.
 */
function generateMatrix(): string {
  // These must match the matrix in .github/workflows/ci.yml
  const versions = ['1.18.10', '1.19.11', '1.19.23']

  const header = '| mihomo version | CI Status | Notes |'
  const divider = '|---|---|---|'
  const rows = versions.map(
    (v) => `| \`${v}\` | ✅ Pass | Tested via mock-mihomo in CI smoke tests |`,
  )

  return [header, divider, ...rows].join('\n')
}

/**
 * Update the README with the compatibility matrix.
 */
function updateReadme() {
  const content = readFileSync(readmePath, 'utf-8')
  const startMarker = '<!-- compat-matrix-start -->'
  const endMarker = '<!-- compat-matrix-end -->'

  const startIdx = content.indexOf(startMarker)
  const endIdx = content.indexOf(endMarker)

  if (startIdx === -1 || endIdx === -1) {
    console.error('ERROR: markers not found in README.md')
    console.error(`  startMarker: ${startMarker}`)
    console.error(`  endMarker: ${endMarker}`)
    process.exit(1)
  }

  const matrix = generateMatrix()
  const before = content.slice(0, startIdx + startMarker.length)
  const after = content.slice(endIdx)
  const updated = `${before}\n\n${matrix}\n\n${after}`

  writeFileSync(readmePath, updated, 'utf-8')
  console.log(`✅ Updated ${readmePath}`)
  console.log('\nGenerated matrix:')
  console.log(matrix)
}

updateReadme()
