# User-defined invariants — examples

Drop a YAML file at `$MIHARBOR_DATA_DIR/invariants.yaml` (default
`/app/data/invariants.yaml`) to add your own lint rules on top of the
universal catalogue. Edit via Settings → Invariants in the UI or by hand.

The examples here are starter templates:

- [`router-wildcard.yaml`](./router-wildcard.yaml) — rules for a mihomo host
  that acts as the apartment router (DNS listener pinned, interface-name
  must be explicit).
- [`no-http-proxies.yaml`](./no-http-proxies.yaml) — forbid any explicit
  HTTP / SOCKS / MIXED listener; TUN is the only interception path.
- [`route-exclude-proxies.yaml`](./route-exclude-proxies.yaml) — guarantee
  your upstream proxy IP is excluded from TUN (self-intercept loop
  prevention) + keep the sniffer on.

## Schema

```yaml
invariants:
  - id: unique-string-id # stable across renames
    name: Human-readable headline # shown in list view
    level: error | warning | info # default: warning
    active: true # uncheck to silence
    description: | # optional, any length
      Why this rule exists — surfaced next to the violation in the UI.
    rule:
      kind: path-must-equal | path-must-not-equal | path-must-be-in | path-must-contain-all
      path: 'dotted.yaml.path' # e.g. "dns.listen"
      # plus rule-kind-specific fields:
      value: 'expected' # path-must-equal
      values: ['allowed', 'values'] # path-must-{not-equal,be-in,contain-all}
```

### Rule kinds

| kind                    | Violation when                                   |
| ----------------------- | ------------------------------------------------ |
| `path-must-equal`       | scalar at `path` ≠ `value` (or path missing)     |
| `path-must-not-equal`   | scalar at `path` ∈ `values`                      |
| `path-must-be-in`       | scalar at `path` ∉ `values` (or path missing)    |
| `path-must-contain-all` | `path` is not a list, or missing any of `values` |

Custom JavaScript predicates are deliberately **not** supported — they'd
let a malicious `invariants.yaml` execute code at lint time.
