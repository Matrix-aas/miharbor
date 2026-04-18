// URL resolution for geo-data sources. Reads the live mihomo config via the
// injected Transport, parses `profile.geox-url.{geoip,geosite}`, and returns
// either the user-configured URL or the mihomo default. Never throws —
// errors (read failure, YAML parse failure) degrade to defaults so the
// catalog endpoint keeps working.

import { parseDocument } from 'yaml'
import type { Transport } from '../transport/transport.ts'
import { DEFAULT_GEOIP_URL, DEFAULT_GEOSITE_URL } from './defaults.ts'

export { DEFAULT_GEOIP_URL, DEFAULT_GEOSITE_URL }

export interface GeoUrls {
  geoip: string
  geosite: string
}

export async function resolveGeoUrls(transport: Transport): Promise<GeoUrls> {
  let content = ''
  try {
    const read = await transport.readConfig()
    content = read.content
  } catch {
    return { geoip: DEFAULT_GEOIP_URL, geosite: DEFAULT_GEOSITE_URL }
  }

  let geoip = DEFAULT_GEOIP_URL
  let geosite = DEFAULT_GEOSITE_URL
  try {
    const doc = parseDocument(content)
    if (doc.errors.length === 0) {
      const userGeoip = doc.getIn(['geox-url', 'geoip'])
      const userGeosite = doc.getIn(['geox-url', 'geosite'])
      if (typeof userGeoip === 'string' && userGeoip.trim().length > 0) {
        geoip = userGeoip.trim()
      }
      if (typeof userGeosite === 'string' && userGeosite.trim().length > 0) {
        geosite = userGeosite.trim()
      }
    }
  } catch {
    // fall through to defaults
  }
  return { geoip, geosite }
}
