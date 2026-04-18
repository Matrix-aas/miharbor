import { describe, expect, it } from 'bun:test'
import { InMemoryTransport } from '../../src/transport/in-memory.ts'
import {
  resolveGeoUrls,
  DEFAULT_GEOIP_URL,
  DEFAULT_GEOSITE_URL,
} from '../../src/catalog/geo-source.ts'

describe('resolveGeoUrls', () => {
  it('falls back to defaults when geox-url is absent', async () => {
    const transport = new InMemoryTransport({ initialConfig: 'mode: rule\n' })
    const r = await resolveGeoUrls(transport)
    expect(r.geoip).toBe(DEFAULT_GEOIP_URL)
    expect(r.geosite).toBe(DEFAULT_GEOSITE_URL)
  })

  it('falls back to defaults when geox-url fields are empty strings', async () => {
    const transport = new InMemoryTransport({
      initialConfig: 'geox-url:\n  geoip: ""\n  geosite: ""\n',
    })
    const r = await resolveGeoUrls(transport)
    expect(r.geoip).toBe(DEFAULT_GEOIP_URL)
    expect(r.geosite).toBe(DEFAULT_GEOSITE_URL)
  })

  it('uses user-configured URLs', async () => {
    const transport = new InMemoryTransport({
      initialConfig:
        'geox-url:\n  geoip: "https://example.com/geoip.dat"\n  geosite: "https://example.com/geosite.dat"\n',
    })
    const r = await resolveGeoUrls(transport)
    expect(r.geoip).toBe('https://example.com/geoip.dat')
    expect(r.geosite).toBe('https://example.com/geosite.dat')
  })

  it('falls back to defaults when YAML is invalid', async () => {
    const transport = new InMemoryTransport({ initialConfig: ': : bad:\n' })
    const r = await resolveGeoUrls(transport)
    expect(r.geoip).toBe(DEFAULT_GEOIP_URL)
    expect(r.geosite).toBe(DEFAULT_GEOSITE_URL)
  })
})
