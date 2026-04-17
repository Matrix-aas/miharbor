/**
 * Bundle budget check — verifies that the initial bundle (index-*.js)
 * does not exceed 600 KB gzipped, and that Monaco editor is correctly
 * lazy-loaded into separate chunks.
 *
 * Acceptance criteria:
 *   - Initial bundle (index-*.js) < 600 KB gzipped
 *   - Monaco editor (editor.api-*.js) exists as a separate chunk
 *   - Initial bundle does not contain "monaco" string
 *
 * Usage:
 *   bun run check-bundle-size
 */

import fs from 'fs'
import path from 'path'
import zlib from 'zlib'

const DIST_DIR = path.join(__dirname, '../dist/assets')
const INITIAL_BUDGET_KB_GZIPPED = 600
const INITIAL_BUDGET_KB_RAW = 1500

interface BundleInfo {
  file: string
  rawBytes: number
  gzippedBytes: number
  rawKb: number
  gzippedKb: number
  containsMonaco: boolean
}

function getFileSize(filePath: string): { raw: number; gzipped: number } {
  const raw = fs.statSync(filePath).size
  const content = fs.readFileSync(filePath)
  const gzipped = zlib.gzipSync(content).length
  return { raw, gzipped }
}

function checkBundleSize(): void {
  console.log('📦 Monaco Lazy-Load Bundle Check\n')

  if (!fs.existsSync(DIST_DIR)) {
    console.error(`❌ dist/assets/ not found at ${DIST_DIR}`)
    console.error('   Run: bun run --filter miharbor-web build')
    process.exit(1)
  }

  const files = fs.readdirSync(DIST_DIR)
  const bundles: BundleInfo[] = []

  // Identify the actual app entry by reading index.html — after the
  // monaco-yaml drop-in, the deps graph contains multiple chunks that
  // happen to be named `index-*.js` (monaco-yaml's own `index.js`, for
  // instance). Using the HTML entry is the only disambiguating source
  // of truth; filesystem ordering isn't stable across platforms.
  const indexHtmlPath = path.join(DIST_DIR, '..', 'index.html')
  let indexFile: string | undefined
  if (fs.existsSync(indexHtmlPath)) {
    const html = fs.readFileSync(indexHtmlPath, 'utf8')
    const entryMatch = html.match(/\/assets\/(index-[a-zA-Z0-9_-]+\.js)/)
    if (entryMatch) indexFile = entryMatch[1]
  }
  // Fallback: any file matching the pattern, largest one wins (the real
  // entry dwarfs monaco-yaml's `index.js` chunk).
  if (!indexFile) {
    const candidates = files.filter((f) => /^index-[a-zA-Z0-9_-]+\.js$/.test(f))
    indexFile = candidates
      .map((f) => ({ f, size: fs.statSync(path.join(DIST_DIR, f)).size }))
      .sort((a, b) => b.size - a.size)[0]?.f
  }
  const editorFile = files.find((f) => f.match(/^editor\.api-[a-zA-Z0-9_-]+\.js$/))
  const monacoYamlEditFile = files.find((f) => f.match(/^MonacoYamlEdit-[a-zA-Z0-9_-]+\.js$/))
  const diff2htmlFile = files.find((f) => f.match(/^diff2html-[a-zA-Z0-9_-]+\.js$/))

  if (!indexFile) {
    console.error('❌ Initial bundle index-*.js not found')
    process.exit(1)
  }

  // Check index bundle
  const indexPath = path.join(DIST_DIR, indexFile)
  const indexSize = getFileSize(indexPath)
  const indexContent = fs.readFileSync(indexPath, 'utf8')
  const indexContainsMonaco = indexContent.includes('monaco')
  const indexContainsEditorApi = indexContent.includes('editor.api')

  bundles.push({
    file: indexFile,
    rawBytes: indexSize.raw,
    gzippedBytes: indexSize.gzipped,
    rawKb: indexSize.raw / 1024,
    gzippedKb: indexSize.gzipped / 1024,
    containsMonaco: indexContainsMonaco,
  })

  if (editorFile) {
    const editorPath = path.join(DIST_DIR, editorFile)
    const editorSize = getFileSize(editorPath)
    bundles.push({
      file: editorFile,
      rawBytes: editorSize.raw,
      gzippedBytes: editorSize.gzipped,
      rawKb: editorSize.raw / 1024,
      gzippedKb: editorSize.gzipped / 1024,
      containsMonaco: true,
    })
  }

  if (monacoYamlEditFile) {
    const editPath = path.join(DIST_DIR, monacoYamlEditFile)
    const editSize = getFileSize(editPath)
    bundles.push({
      file: monacoYamlEditFile,
      rawBytes: editSize.raw,
      gzippedBytes: editSize.gzipped,
      rawKb: editSize.raw / 1024,
      gzippedKb: editSize.gzipped / 1024,
      containsMonaco: false,
    })
  }

  if (diff2htmlFile) {
    const diff2htmlPath = path.join(DIST_DIR, diff2htmlFile)
    const diff2htmlSize = getFileSize(diff2htmlPath)
    bundles.push({
      file: diff2htmlFile,
      rawBytes: diff2htmlSize.raw,
      gzippedBytes: diff2htmlSize.gzipped,
      rawKb: diff2htmlSize.raw / 1024,
      gzippedKb: diff2htmlSize.gzipped / 1024,
      containsMonaco: false,
    })
  }

  // Print results
  console.log('Bundle sizes:')
  console.log('-'.repeat(80))
  bundles.forEach((b) => {
    const rawStr = `${b.rawKb.toFixed(1)} KB`
    const gzStr = `${b.gzippedKb.toFixed(1)} KB gzipped`
    console.log(`  ${b.file.padEnd(40)} ${rawStr.padEnd(12)} ${gzStr}`)
  })
  console.log('-'.repeat(80))

  // Validate acceptance criteria
  let hasFailed = false

  // AC1: Initial bundle < 600 KB gzipped
  const gzippedKb = indexSize.gzipped / 1024
  const rawKb = indexSize.raw / 1024
  if (gzippedKb > INITIAL_BUDGET_KB_GZIPPED) {
    console.error(
      `\n❌ AC1 FAIL: Initial bundle gzipped size (${gzippedKb.toFixed(1)} KB) exceeds ${INITIAL_BUDGET_KB_GZIPPED} KB`,
    )
    hasFailed = true
  } else {
    console.log(
      `\n✅ AC1 PASS: Initial bundle gzipped size (${gzippedKb.toFixed(1)} KB) ≤ ${INITIAL_BUDGET_KB_GZIPPED} KB`,
    )
  }

  if (rawKb > INITIAL_BUDGET_KB_RAW) {
    console.error(
      `\n⚠️  Warning: Initial bundle raw size (${rawKb.toFixed(1)} KB) exceeds ${INITIAL_BUDGET_KB_RAW} KB`,
    )
  }

  // AC2: Monaco editor in separate chunk
  if (!editorFile) {
    console.error(`\n❌ AC2 FAIL: editor.api-*.js chunk not found (Monaco not separate)`)
    hasFailed = true
  } else {
    console.log(`\n✅ AC2 PASS: Monaco editor in separate chunk (${editorFile})`)
  }

  // AC3: Initial bundle does not contain Monaco code
  if (indexContainsMonaco) {
    console.error(`\n❌ AC3 FAIL: Initial bundle contains "monaco" string (not lazy-loaded)`)
    hasFailed = true
  } else {
    console.log(`\n✅ AC3 PASS: Initial bundle does not contain "monaco" reference`)
  }

  // AC4: Initial bundle does not eagerly reference editor.api
  if (indexContainsEditorApi) {
    console.error(`\n❌ AC4 FAIL: Initial bundle references "editor.api" (eager import)`)
    hasFailed = true
  } else {
    console.log(`\n✅ AC4 PASS: Initial bundle does not reference "editor.api"`)
  }

  // Summary
  console.log('\n' + '='.repeat(80))
  if (hasFailed) {
    console.error('❌ Bundle budget check FAILED')
    process.exit(1)
  } else {
    console.log('✅ Bundle budget check PASSED')
    console.log(
      `   Initial: ${gzippedKb.toFixed(1)} KB gzipped (budget: ${INITIAL_BUDGET_KB_GZIPPED} KB)`,
    )
    if (editorFile) {
      const editorKb = (getFileSize(path.join(DIST_DIR, editorFile)).gzipped / 1024).toFixed(1)
      console.log(`   Monaco:  ${editorKb} KB gzipped (lazy-loaded)`)
    }
    console.log('='.repeat(80))
  }
}

checkBundleSize()
