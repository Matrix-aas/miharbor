// Mihomo's compiled GeoXUrl defaults — kept in sync with upstream.
// Source: MetaCubeX/mihomo config/config.go → DefaultRawConfig().GeoXUrl.
// Updated: 2026-04 (matches the Alpha branch constants as of this date).
// When mihomo bumps these, update here too — we intentionally DON'T fetch
// the defaults from a remote registry to keep the app deterministic.

export const DEFAULT_GEOIP_URL =
  'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat'

export const DEFAULT_GEOSITE_URL =
  'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat'
