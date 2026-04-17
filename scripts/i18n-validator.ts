/**
 * i18n validator: checks parity between en.json and ru.json
 * Exit 0 on success, 1 if mismatches found
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url)).replace('/scripts', '')

// Flatten nested object into dot-paths
function flattenObject(obj: any, prefix = ''): Record<string, any> {
  const result: Record<string, any> = {}

  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value, path))
    } else {
      result[path] = value
    }
  }

  return result
}

// Load JSON files
function loadJSON(filePath: string) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch (err) {
    throw new Error(`Failed to load ${filePath}: ${err}`)
  }
}

// Main validation
function validateI18n() {
  const enPath = resolve(__dirname, 'apps/web/src/i18n/en.json')
  const ruPath = resolve(__dirname, 'apps/web/src/i18n/ru.json')

  const en = loadJSON(enPath)
  const ru = loadJSON(ruPath)

  const enFlat = flattenObject(en)
  const ruFlat = flattenObject(ru)

  const enKeys = Object.keys(enFlat).sort()
  const ruKeys = Object.keys(ruFlat).sort()

  const enSet = new Set(enKeys)
  const ruSet = new Set(ruKeys)

  let hasErrors = false

  // Check for missing keys in RU
  const missingInRu = enKeys.filter((k) => !ruSet.has(k))
  if (missingInRu.length > 0) {
    console.error(`\n❌ Missing in ru.json (${missingInRu.length} keys):`)
    missingInRu.forEach((k) => {
      console.error(`   - ${k}: "${enFlat[k]}"`)
    })
    hasErrors = true
  }

  // Check for extra keys in RU
  const extraInRu = ruKeys.filter((k) => !enSet.has(k))
  if (extraInRu.length > 0) {
    console.error(`\n❌ Extra in ru.json (${extraInRu.length} keys):`)
    extraInRu.forEach((k) => {
      console.error(`   - ${k}`)
    })
    hasErrors = true
  }

  // Check for empty values (empty strings are OK only if source is empty)
  const emptyValuesInRu = enKeys.filter((k) => {
    const enVal = enFlat[k]
    const ruVal = ruFlat[k]
    // Empty string in RU is only OK if EN is also empty
    return ruVal === '' && enVal !== ''
  })
  if (emptyValuesInRu.length > 0) {
    console.error(`\n❌ Empty translations in ru.json (${emptyValuesInRu.length} keys):`)
    emptyValuesInRu.forEach((k) => {
      console.error(`   - ${k}: "" (en: "${enFlat[k]}")`)
    })
    hasErrors = true
  }

  if (!hasErrors) {
    console.log('✅ i18n parity check passed!')
    console.log(`   EN: ${enKeys.length} keys`)
    console.log(`   RU: ${ruKeys.length} keys`)
  }

  process.exit(hasErrors ? 1 : 0)
}

validateI18n()
