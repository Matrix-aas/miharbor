// Deprecation mapping for ENV names. Old names are retained for one minor
// release with a WARN-level log, then removed.

const DEPRECATIONS: Record<string, string> = {
  MIHARBOR_CFG_PATH: 'MIHARBOR_CONFIG_PATH',
}

export function applyDeprecations(
  raw: Record<string, string | undefined>,
  warn: (m: string) => void,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...raw }
  for (const [old, replacement] of Object.entries(DEPRECATIONS)) {
    if (out[old] !== undefined && out[replacement] === undefined) {
      warn(`ENV ${old} is deprecated, use ${replacement}`)
      out[replacement] = out[old]
    }
    delete out[old]
  }
  return out
}
