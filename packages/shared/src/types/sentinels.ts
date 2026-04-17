// View-scope masking sentinels.
//
// The vault owns per-secret UUID sentinels (`$MIHARBOR_VAULT:<uuid>`) for the
// draft round-trip path. But the JSON view endpoints (/api/config/meta,
// /api/config/proxies) don't go through the vault — they're a separate,
// read-only projection whose callers (the SPA's store, 3rd-party scripts) may
// deserialize + display the values without ever parsing a mihomo YAML.
//
// Leaving secrets verbatim in those responses means anyone with devtools can
// read the mihomo `secret:` Bearer or a WireGuard `private-key` off the
// network tab. So we mask those fields with FIXED literal sentinels before
// the JSON leaves the server:
//
//   - `META_SECRET_SENTINEL` — underscored literal, shape is obvious "this
//     was masked on the server; it is NOT the real value". Used for the
//     mihomo `secret:` Bearer on /api/config/meta.
//   - `WIREGUARD_PRIVATE_KEY_SENTINEL` /
//     `WIREGUARD_PRE_SHARED_KEY_SENTINEL` — 44-char base64-valid strings
//     deliberately shaped so they pass the client-side
//     `isValidWireGuardKey` regex (`^[A-Za-z0-9+/]+=*$`, len ≥ 40). That
//     lets the WireGuardForm display them in the masked-by-default input
//     WITHOUT tripping the "not a valid WireGuard key" error.
//
// Round-trip contract (deploy pipeline):
//   If any of these three sentinels appears as a scalar VALUE under a
//   matching KEY in the draft YAML at deploy time, the pipeline MUST
//   substitute the sentinel with the CURRENT on-disk value (the draft
//   obviously never "saw" the real secret, so leaving the sentinel through
//   would wipe mihomo's Bearer / a WireGuard key). See
//   apps/server/src/deploy/pipeline.ts.
//
// The per-secret vault sentinels (`$MIHARBOR_VAULT:<uuid>`) remain the
// primary masking mechanism for the draft pipeline itself — these three
// fixed sentinels are only about the read-only JSON views.

/** Sentinel substituted for `/api/config/meta.secret` on the server. */
export const META_SECRET_SENTINEL = '__MIHARBOR_SECRET_SET_NOT_SHOWN__'

/** Sentinel substituted for every WireGuard `private-key` on
 *  `/api/config/proxies`. 44 base64-valid chars so `isValidWireGuardKey`
 *  accepts it (client-side form validator). */
export const WIREGUARD_PRIVATE_KEY_SENTINEL = 'MIHARBORMASKEDPRIVATEKEYREENTERTOCHANGE1234='

/** Sentinel substituted for every WireGuard `pre-shared-key` on
 *  `/api/config/proxies`. 44 base64-valid chars (see above). */
export const WIREGUARD_PRE_SHARED_KEY_SENTINEL = 'MIHARBORMASKEDPRESHAREDKEYREENTERTOCHANGE12='

/** Predicate — is the given string one of our masking sentinels? Useful
 *  for the deploy pipeline's "keep existing value" gate. */
export function isMiharborViewSentinel(value: unknown): boolean {
  return (
    value === META_SECRET_SENTINEL ||
    value === WIREGUARD_PRIVATE_KEY_SENTINEL ||
    value === WIREGUARD_PRE_SHARED_KEY_SENTINEL
  )
}
