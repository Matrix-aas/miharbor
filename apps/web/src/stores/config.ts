// Config store — caches services/proxies/meta/raw plus the mutable draft.
//
// Stage 1 architecture:
//   * `draftText` is the authoritative state — every mutation serialises
//     through it.
//   * `draftDoc` is a lazy cache of the parsed YAML `Document` for the
//     structured views. Any mutation that touches the document also
//     re-serialises and updates `draftText`.
//   * `services` / `proxies` are recomputed from the live config on every
//     `loadAll()` call; while editing, the Services/Proxies screens should
//     read from `draftServices` / `draftProxies` which project the draft
//     document (so edits are reactive).
//   * A debounced POST /api/lint runs after every draft change and fills in
//     `issuesByService`.

import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { Document } from 'yaml'
import type { DnsConfig, Issue, ProxyNode, Rule, Service, TunConfig } from 'miharbor-shared'
import { endpoints, ApiError } from '@/api/client'
import type { DraftResponse } from '@/api/client'
import {
  createService,
  deleteServiceWithRules,
  insertRule,
  listGroupNames,
  listProxyNodeNames,
  parseDraft,
  removeProxyNode,
  removeRule,
  replaceRule,
  serializeDraft,
  setDnsConfig,
  setGroupDirection,
  setTunConfig,
  upsertProxyNode,
  YAMLMap,
  isMap,
  isSeq,
} from '@/lib/yaml-mutator'
import { getDnsConfig } from '@/lib/dns-view'
import { getTunConfig } from '@/lib/tun-view'
import type { Node, YAMLSeq } from 'yaml'
import { parseRulesFromDoc } from 'miharbor-shared'

const LINT_DEBOUNCE_MS = 500

function deriveServices(doc: Document): Service[] {
  // Mirror of apps/server/src/config/views/services.ts — replicated so the
  // UI can show live-updating services while typing in RuleEditor.
  const groupsNode = doc.getIn(['proxy-groups']) as unknown
  if (!groupsNode || !isSeq(groupsNode as Node)) return []
  const groups = groupsNode as YAMLSeq

  let allRules: { index: number; rule: Rule }[]
  try {
    allRules = parseRulesFromDoc(doc)
  } catch {
    allRules = []
  }

  const services: Service[] = []
  for (const g of groups.items) {
    if (!isMap(g as Node)) continue
    const gm = g as YAMLMap
    const name = String(gm.get('name') ?? '')
    if (!name) continue
    const type = String(gm.get('type') ?? 'select')
    const proxies: string[] = []
    const proxiesNode = gm.get('proxies') as unknown
    if (proxiesNode && isSeq(proxiesNode as Node)) {
      for (const p of (proxiesNode as YAMLSeq).items) {
        const v =
          typeof p === 'object' && p !== null && 'value' in p
            ? String((p as { value: unknown }).value)
            : String(p)
        proxies.push(v)
      }
    }
    const url = gm.get('url')
    const interval = gm.get('interval')
    const hidden = gm.get('hidden')

    const group = {
      name,
      type: (type === 'url-test' ||
      type === 'fallback' ||
      type === 'load-balance' ||
      type === 'relay'
        ? type
        : 'select') as Service['group']['type'],
      proxies,
      ...(typeof url === 'string' ? { url } : {}),
      ...(typeof interval === 'number' ? { interval } : {}),
      ...(typeof hidden === 'boolean' ? { hidden } : {}),
    }

    const relatedRules = allRules.filter((r) => r.rule.target === name)
    let direction: Service['direction']
    if (group.type !== 'select') direction = 'MIXED'
    else {
      const first = group.proxies[0]
      if (first === 'DIRECT') direction = 'DIRECT'
      else if (first === 'REJECT') direction = 'REJECT'
      else if (!first) direction = 'MIXED'
      else direction = 'VPN'
    }

    services.push({ name, group, rules: relatedRules, direction, issues: [] })
  }
  return services
}

function deriveProxies(doc: Document): ProxyNode[] {
  // Duplicate the server's getProxies() projection so edits while typing
  // reflect immediately in the list.
  const proxiesNode = doc.getIn(['proxies']) as unknown
  if (!proxiesNode || !isSeq(proxiesNode as Node)) return []
  const seq = proxiesNode as YAMLSeq
  const out: ProxyNode[] = []
  for (const item of seq.items) {
    if (!isMap(item as Node)) continue
    const json = (item as YAMLMap).toJSON() as Record<string, unknown>
    if (!json || typeof json !== 'object') continue
    const name = String(json.name ?? '')
    const type = String(json.type ?? '')
    const server = String(json.server ?? '')
    const port = Number(json.port ?? 0)
    if (!name || !type || !server || !port) continue
    // WireGuard gets its typed projection; other types pass through.
    out.push({ ...json, name, server, port } as ProxyNode)
  }
  return out
}

export const useConfigStore = defineStore('config', () => {
  const servicesLive = ref<Service[]>([])
  const proxiesLive = ref<ProxyNode[]>([])
  const meta = ref<Record<string, unknown> | null>(null)
  const rawLive = ref<string | null>(null)
  const draft = ref<DraftResponse | null>(null)
  const draftText = ref<string | null>(null)
  const draftError = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  /** Map from service-name → Issue[] (populated by debounced lint call). */
  const issuesByService = ref<Record<string, Issue[]>>({})
  /** Runtime proxy-group state from mihomo API (name → `now`). */
  const liveProxyState = ref<Record<string, string>>({})

  const hasDraft = computed(
    () => draft.value?.source === 'draft' && (draft.value.text?.length ?? 0) > 0,
  )

  const dirtyCount = computed<number>(() => {
    if (!draftText.value) return 0
    if (!rawLive.value) return 0
    return draftText.value === rawLive.value ? 0 : 1
  })

  // Derived services/proxies — recomputed on every draftText change.
  const draftServices = computed<Service[]>(() => {
    if (!draftText.value) return servicesLive.value
    try {
      const doc = parseDraft(draftText.value)
      const services = deriveServices(doc)
      // Merge in issues from last lint pass.
      return services.map((s) => ({ ...s, issues: issuesByService.value[s.name] ?? [] }))
    } catch {
      return []
    }
  })

  const draftProxies = computed<ProxyNode[]>(() => {
    if (!draftText.value) return proxiesLive.value
    try {
      const doc = parseDraft(draftText.value)
      return deriveProxies(doc)
    } catch {
      return []
    }
  })

  const existingGroupNames = computed<string[]>(() => {
    if (!draftText.value) return servicesLive.value.map((s) => s.name)
    try {
      return listGroupNames(parseDraft(draftText.value))
    } catch {
      return []
    }
  })

  const existingProxyNodeNames = computed<string[]>(() => {
    if (!draftText.value) return proxiesLive.value.map((p) => p.name)
    try {
      return listProxyNodeNames(parseDraft(draftText.value))
    } catch {
      return []
    }
  })

  /** Typed view of the `dns:` section from the draft. Recomputes on every
   *  draft change; empty object when the section is absent or the doc is
   *  unparseable (the editor surfaces parse errors elsewhere). */
  const dnsConfig = computed<DnsConfig>(() => {
    if (!draftText.value) return {}
    try {
      return getDnsConfig(parseDraft(draftText.value))
    } catch {
      return {}
    }
  })

  /** Typed view of the `tun:` section from the draft. Same contract as
   *  `dnsConfig` — recomputes on every draft change; empty object on missing
   *  section or parse error. */
  const tunConfig = computed<TunConfig>(() => {
    if (!draftText.value) return {}
    try {
      return getTunConfig(parseDraft(draftText.value))
    } catch {
      return {}
    }
  })

  async function loadAll(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const [svc, prx, mta, raw, drft] = await Promise.all([
        endpoints.config.services(),
        endpoints.config.proxies(),
        endpoints.config.meta(),
        endpoints.config.raw(),
        endpoints.config.draft(),
      ])
      servicesLive.value = (svc as Service[]) ?? []
      proxiesLive.value = (prx as ProxyNode[]) ?? []
      meta.value = mta as Record<string, unknown>
      rawLive.value = raw
      draft.value = drft
      draftText.value = drft.text
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : (e as Error).message
    } finally {
      loading.value = false
    }
  }

  async function fetchLiveProxyState(): Promise<void> {
    try {
      const response = await endpoints.mihomo.proxies()
      const proxies = (response as { proxies?: Record<string, unknown> }).proxies ?? response
      const out: Record<string, string> = {}
      if (proxies && typeof proxies === 'object') {
        for (const [name, info] of Object.entries(proxies)) {
          if (info && typeof info === 'object' && 'now' in info) {
            const now = (info as { now: unknown }).now
            if (typeof now === 'string') out[name] = now
          }
        }
      }
      liveProxyState.value = out
    } catch {
      // Mihomo may be down — UIs show a warning badge and fall back to proxies[0].
      liveProxyState.value = {}
    }
  }

  /** Low-level: overwrite the draft with fresh text and PUT to the server.
   *  Callers that already hold a mutated Document should call `commitDoc`. */
  async function putDraft(yaml: string): Promise<void> {
    draftText.value = yaml
    draft.value = { source: 'draft', text: yaml, updated: new Date().toISOString() }
    try {
      await endpoints.config.putDraft(yaml)
      draftError.value = null
    } catch (e) {
      draftError.value = e instanceof ApiError ? e.message : (e as Error).message
      throw e
    }
    scheduleLint()
  }

  /** Serialize `doc` and persist. Preferred entry point for the structured
   *  mutators below. */
  async function commitDoc(doc: Document): Promise<void> {
    const text = serializeDraft(doc)
    await putDraft(text)
  }

  async function clearDraft(): Promise<void> {
    await endpoints.config.clearDraft()
    if (rawLive.value !== null) {
      draft.value = { source: 'current', text: rawLive.value }
      draftText.value = rawLive.value
    } else {
      draft.value = null
      draftText.value = null
    }
    issuesByService.value = {}
  }

  // ----- debounced lint --------------------------------------------------

  let lintTimer: ReturnType<typeof setTimeout> | null = null
  function scheduleLint(): void {
    if (lintTimer) clearTimeout(lintTimer)
    lintTimer = setTimeout(runLint, LINT_DEBOUNCE_MS)
  }

  async function runLint(): Promise<void> {
    const text = draftText.value
    if (!text) {
      issuesByService.value = {}
      return
    }
    try {
      const { issues } = await endpoints.lint(text)
      const map: Record<string, Issue[]> = {}
      for (const issue of issues) {
        // Issues with path starting at ['proxy-groups', N, …] or
        // ['rules', N, target=<name>] — best-effort fan-out to services. For
        // MVP we stash all issues under their stringified path root; the
        // linter already provides `params.service` for most codes.
        const service = (issue.params?.service as string | undefined) ?? inferServiceFromPath(issue)
        if (!service) continue
        const list = map[service] ?? (map[service] = [])
        list.push(issue)
      }
      issuesByService.value = map
    } catch {
      // Don't block editing when lint is transiently unavailable.
    }
  }

  function inferServiceFromPath(issue: Issue): string | null {
    // Heuristic: if path[0] === 'proxy-groups' and path[1] is numeric, there
    // isn't enough info to know the group name without the full doc. We keep
    // this null for now; server-side linters already emit params.service for
    // duplicate / dangling rule checks.
    if (issue.path[0] === 'rules' && typeof issue.params?.target === 'string') {
      return issue.params.target as string
    }
    return null
  }

  // ----- structured mutators (the UI calls these) ------------------------

  async function addRuleToService(serviceName: string, rule: Rule): Promise<void> {
    if (!draftText.value) throw new Error('no draft')
    const doc = parseDraft(draftText.value)
    insertRule(doc, { ...rule, target: serviceName })
    await commitDoc(doc)
  }

  async function replaceRuleAt(index: number, rule: Rule): Promise<void> {
    if (!draftText.value) throw new Error('no draft')
    const doc = parseDraft(draftText.value)
    replaceRule(doc, index, rule)
    await commitDoc(doc)
  }

  async function removeRuleAt(index: number): Promise<void> {
    if (!draftText.value) throw new Error('no draft')
    const doc = parseDraft(draftText.value)
    removeRule(doc, index)
    await commitDoc(doc)
  }

  async function setServiceDirection(
    serviceName: string,
    direction: 'VPN' | 'DIRECT' | 'REJECT',
  ): Promise<void> {
    if (!draftText.value) throw new Error('no draft')
    const doc = parseDraft(draftText.value)
    setGroupDirection(doc, serviceName, direction)
    await commitDoc(doc)
  }

  async function createNewService(input: {
    name: string
    direction: 'VPN' | 'DIRECT' | 'REJECT'
    vpnFallback?: string[]
  }): Promise<void> {
    if (!draftText.value) {
      // No current doc — bootstrap a fresh draft from live config text.
      if (rawLive.value === null) {
        throw new Error('no live config to bootstrap draft from')
      }
      draftText.value = rawLive.value
    }
    const doc = parseDraft(draftText.value)
    createService(doc, input)
    await commitDoc(doc)
  }

  async function deleteServiceDraft(name: string): Promise<number> {
    if (!draftText.value) throw new Error('no draft')
    const doc = parseDraft(draftText.value)
    const removed = deleteServiceWithRules(doc, name)
    await commitDoc(doc)
    return removed
  }

  async function upsertProxyNodeDraft(node: ProxyNode): Promise<void> {
    if (!draftText.value) {
      if (rawLive.value === null) throw new Error('no live config to bootstrap draft from')
      draftText.value = rawLive.value
    }
    const doc = parseDraft(draftText.value)
    upsertProxyNode(doc, node)
    await commitDoc(doc)
  }

  async function removeProxyNodeDraft(name: string): Promise<void> {
    if (!draftText.value) throw new Error('no draft')
    const doc = parseDraft(draftText.value)
    removeProxyNode(doc, name)
    await commitDoc(doc)
  }

  /** Replace the entire `dns:` section in the draft with `config`. The Dns
   *  screen calls this on every structured edit; the PUT is debounced by the
   *  store's lint pipeline. Passes `extras` through unchanged. */
  async function setDnsConfigDraft(config: DnsConfig): Promise<void> {
    if (!draftText.value) {
      if (rawLive.value === null) throw new Error('no live config to bootstrap draft from')
      draftText.value = rawLive.value
    }
    const doc = parseDraft(draftText.value)
    setDnsConfig(doc, config)
    await commitDoc(doc)
  }

  /** Replace the entire `tun:` section in the draft with `config`. Same
   *  contract as `setDnsConfigDraft`. */
  async function setTunConfigDraft(config: TunConfig): Promise<void> {
    if (!draftText.value) {
      if (rawLive.value === null) throw new Error('no live config to bootstrap draft from')
      draftText.value = rawLive.value
    }
    const doc = parseDraft(draftText.value)
    setTunConfig(doc, config)
    await commitDoc(doc)
  }

  // Initial lint on first load.
  watch(
    () => draftText.value,
    (newText, oldText) => {
      if (newText && newText !== oldText) scheduleLint()
    },
  )

  return {
    // live state
    servicesLive,
    proxiesLive,
    meta,
    rawLive,
    draft,
    draftText,
    draftError,
    loading,
    error,
    hasDraft,
    dirtyCount,
    issuesByService,
    liveProxyState,
    // derived
    services: draftServices,
    proxies: draftProxies,
    existingGroupNames,
    existingProxyNodeNames,
    dnsConfig,
    tunConfig,
    // lifecycle
    loadAll,
    fetchLiveProxyState,
    putDraft,
    clearDraft,
    // structured mutators
    addRuleToService,
    replaceRuleAt,
    removeRuleAt,
    setServiceDirection,
    createNewService,
    deleteServiceDraft,
    upsertProxyNodeDraft,
    removeProxyNodeDraft,
    setDnsConfigDraft,
    setTunConfigDraft,
  }
})
