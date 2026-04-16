# Miharbor — Stage 3: Умности высокого уровня

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development or superpowers-extended-cc:executing-plans.

**Goal:** DNS+GEOIP линтер, impact-preview, LLM-ассистент (allow-list + consent), импорт нод из URL, демо-материалы. Релиз `v1.0.0`.

**Предпосылки:** Этапы 1 и 2 завершены, проект проверен в реальной эксплуатации, feedback собран.

---

## Task 54: Geodata loader — `.dat` / `.mrs` reader

**Goal:** Читать `geosite.dat` и `geoip.dat` (v2fly format) + `.mrs` rule-provider формат.

**Files:**
- Create: `packages/shared/src/geodata/mrs-reader.ts`
- Create: `apps/server/src/linter-server/geoip-loader.ts`
- Create: `apps/server/src/linter-server/geosite-loader.ts`
- Create: `packages/shared/tests/geodata/mrs-reader.test.ts`

**Acceptance Criteria:**
- [ ] Парсер формата v2fly `.dat` (protobuf)
- [ ] `GeoSite.contains(domain, category)` и `GeoIP.lookup(ip) → country`
- [ ] Источник: читаем `.dat` из `${MIHARBOR_CONFIG_DIR}` (тот же что у mihomo — H8 ревью)
- [ ] Lazy-load + cache при старте

---

## Task 55: Linter 6 — Live DNS + GEOIP lookup

**Goal:** Серверный endpoint `/api/lint/dns` + UI-подсказки.

**Files:**
- Create: `apps/server/src/linter-server/dns-lookup.ts`
- Create: `apps/server/src/routes/dns-lookup.ts`
- Create: `apps/web/src/components/rules/DnsLookupBadge.vue`

**Acceptance Criteria:**
- [ ] `POST /api/lint/dns-lookup` принимает domain → `{ips, geoip, covered_by_existing_rule?}`
- [ ] DoH-запрос к `MIHARBOR_DOH_RESOLVER` (default `1.1.1.1`)
- [ ] Кэш 1 час in-memory
- [ ] UI: при редактировании DOMAIN-SUFFIX правила — inline-бейдж с результатом

---

## Task 56: Linter 7 — Impact preview

**Goal:** Эвристические предупреждения при переключении группы VPN↔DIRECT.

**Files:**
- Create: `packages/shared/src/linter/impact.ts`
- Create: `packages/shared/src/templates/impact-templates.json`
- Create: `apps/web/src/components/services/ImpactBanner.vue`

**Acceptance Criteria:**
- [ ] Шаблоны: `RU трафик → VPN`, `Cloudflare → DIRECT`, ~10 штук
- [ ] Локализованы (EN+RU, PR-friendly через JSON — L6 ревью)
- [ ] Inline-плашка в ServiceDetail при смене направления

---

## Task 57: LLM-ассистент — backend (allow-list + provider abstraction)

**Goal:** Серверный слой для LLM, отправка контекста только из allow-list.

**Files:**
- Create: `apps/server/src/llm/context-builder.ts`
- Create: `apps/server/src/llm/anthropic.ts`
- Create: `apps/server/src/llm/openai.ts`
- Create: `apps/server/src/llm/patch-applier.ts`
- Create: `apps/server/src/routes/llm.ts`
- Create: `apps/server/tests/llm/context-builder.test.ts`
- Create: `packages/shared/src/llm/context-allowlist.ts`

**Acceptance Criteria:**
- [ ] `contextBuilder(doc, allowlist)` возвращает **только** белый список секций: `rules`, `proxy-groups` (name+type), `rule-providers` (meta), meta
- [ ] Тесты: pass конфиг с секретами → context НЕ содержит секретов
- [ ] POST `/api/llm/ask` с prompt → стримит ответ LLM
- [ ] Ответ — либо текст, либо diff-патч (SEARCH/REPLACE blocks)

---

## Task 58: LLM-ассистент — frontend (drawer, consent, diff-apply)

**Goal:** UI-часть ассистента.

**Files:**
- Create: `apps/web/src/components/llm/LlmDrawer.vue`
- Create: `apps/web/src/components/llm/ConsentDialog.vue`
- Create: `apps/web/src/components/llm/PatchPreview.vue`

**Acceptance Criteria:**
- [ ] Открывается по `Ctrl+K` или кнопке в хедере
- [ ] Перед запросом — ConsentDialog с превью «что отправляется» (rules/proxy-groups/meta; НЕ proxies/dns/secret)
- [ ] Галочка «не спрашивать 30 мин» (тайм-аут, не навсегда)
- [ ] Ответ с patch → PatchPreview → «Принять» → добавляет в draft-store
- [ ] `MIHARBOR_LLM_DISABLED=true` скрывает UI-часть полностью

---

## Task 59: LLM-key management + validation

**Goal:** UI для хранения ключей с validation формата.

**Files:**
- Modify: `apps/web/src/pages/Settings.vue` — LLM-секция
- Create: `apps/server/src/routes/llm-keys.ts`

**Acceptance Criteria:**
- [ ] Ввод ключа в UI → валидация формата (Anthropic `^sk-ant-...`, OpenAI `^sk-(proj-)?...`)
- [ ] Сохранение в `MIHARBOR_DATA_DIR/secrets.json` (mode 600)
- [ ] `MIHARBOR_PRODUCTION=true` блокирует UI-ввод (только ENV)
- [ ] Status-индикатор «ключ задан ✓ / не задан»

---

## Task 60: Импорт нод из URL

**Goal:** Парсинг `vless://…`, `ss://…`, `vmess://…`, `trojan://…`, полный WireGuard conf.

**Files:**
- Create: `apps/server/src/mihomo/url-importer.ts`
- Create: `apps/web/src/components/proxies/ImportUrlDialog.vue`

**Acceptance Criteria:**
- [ ] Парсит 5 типов URL
- [ ] Для `.conf` (WireGuard) — загрузка файла через drag-n-drop
- [ ] После парсинга — заполняет форму соответствующего типа
- [ ] Тесты на 5 типов URL с реальными примерами (не содержащими секретов)

---

## Task 61: Prometheus метрики

**Goal:** `/metrics` endpoint с минимальным набором (spec §11.2).

**Files:**
- Create: `apps/server/src/observability/metrics.ts`
- Create: `apps/server/src/routes/metrics.ts`

**Acceptance Criteria:**
- [ ] Все метрики из спеки экспортированы
- [ ] `MIHARBOR_METRICS_DISABLED=true` выключает endpoint (404)

---

## Task 62: Демо-материалы (README полишинг)

**Goal:** Скриншоты, GIF-демо, ссылки в сообществах.

**Files:**
- Create: `docs/screenshots/` — 10 скриншотов ключевых экранов
- Create: `docs/demo.gif` — 20-сек сценарий (запись через `asciinema` или `ttygif`)
- Modify: `README.md` + `README.ru.md` — секция «Features» с скриншотами
- Создать GitHub Discussions в репо для feedback

**Acceptance Criteria:**
- [ ] Скриншоты оптимизированы (< 300KB каждый)
- [ ] GIF под 5MB
- [ ] README content отражает v1.0 функционал

---

## Task 63: SBOM + supply chain hardening

**Goal:** Улучшить безопасность образа.

**Files:**
- Modify: `.github/workflows/release.yml`

**Acceptance Criteria:**
- [ ] Cosign-signing GHCR image
- [ ] SBOM (SPDX) в release assets
- [ ] `docker scout` отчёт при build
- [ ] Нотификации в GitHub Security (dependabot + scan)

---

## Task 64: Release v1.0.0

**Acceptance Criteria:**
- [ ] Все задачи этапа `completed`
- [ ] CI зелёный
- [ ] Threat model в SECURITY.md **обновлена** с учётом LLM-рисков (prompt injection, context leakage) и рекомендациями по mitigation
- [ ] Все allow-list тесты зелёные на **100%** покрытии (jest/bun-coverage strict)
- [ ] Security-review LLM-слоя отдельным code-reviewer агентом **перед** release
- [ ] Migration-safety v0.2.0 → v1.0.0 (как в этапе 2)
- [ ] `v1.0.0` tag + release notes
- [ ] Анонс в mihomo GitHub Discussions, r/selfhosted, t.me-каналах

---

## Бонус (после v1.0, вне основного плана)

- Plugin-система для smart-checks (v2.x)
- Multi-server / multi-context (разные экземпляры mihomo в одном UI)
- Home Assistant integration через HTTP API
- Mobile app (native Vue components)
- i18n beyond EN/RU: CN, DE, ES, FR, IT
