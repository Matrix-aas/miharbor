# Miharbor — Stage 2: Полнота покрытия

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development or superpowers-extended-cc:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Добить все оставшиеся секции конфига (DNS, TUN, Sniffer, Rule-providers), tree-editor для AND/OR правил, Raw YAML full-edit, SshTransport, линтеры 4/5 и user-invariants, полная RU-локализация. Релиз `v0.2.0`.

**Предпосылки:** Этап 1 завершён, MVP использовался минимум неделю, найденные UX-баги из feedback вошли в задачи ниже или в отдельный hotfix-релиз.

**Детальные шаги задач пишутся непосредственно перед их выполнением** (структуру держим грубо, чтобы не закоммитить детали до того как задачи этапа 1 выявят реальные потребности).

---

## Task 34: Раздел «DNS»

**Goal:** Полный UI для секции `dns:` — все поля структурно.

**Files:**
- Create: `apps/web/src/pages/Dns.vue`
- Create: `apps/web/src/components/dns/NameserverList.vue`
- Create: `apps/web/src/components/dns/FakeIpFilterList.vue`
- Create: `apps/web/src/components/dns/NameserverPolicy.vue`
- Modify: `apps/server/src/config/views/dns.ts` — добавить view-проекцию

**Acceptance Criteria:**
- [ ] Все поля `dns:` из spec §4 «Экран DNS» редактируются
- [ ] Критичные поля (listen, proxy-server-nameserver, default-nameserver) — с guardrail-плашкой
- [ ] `nameserver-policy` как сортируемая таблица

**Verify:** изменение `dns.ipv6` → в диффе ровно 1 строка; все guardrail'ы срабатывают.

---

## Task 35: Раздел «TUN»

**Goal:** UI для `tun:` + динамическая проверка `route-exclude-address` против нод.

**Files:**
- Create: `apps/web/src/pages/Tun.vue`
- Create: `apps/web/src/components/tun/TunConfigForm.vue`
- Create: `apps/web/src/components/tun/RouteExcludeList.vue`

**Acceptance Criteria:**
- [ ] Тумблеры `enable/auto-route/auto-redirect/auto-detect-interface/strict-route`
- [ ] Dropdown stack (system/gvisor/mixed)
- [ ] RouteExcludeList подсвечивает «это IP прокси-ноды, не удаляй»
- [ ] Редактирование `device`, `mtu`, `dns-hijack`

---

## Task 36: Раздел «Sniffer»

**Goal:** UI для `sniffer:`.

**Files:**
- Create: `apps/web/src/pages/Sniffer.vue`
- Create: `apps/web/src/components/sniffer/SniffRulesList.vue`

**Acceptance Criteria:**
- [ ] Тумблер enable
- [ ] HTTP/TLS/QUIC порты — редактируемые диапазоны
- [ ] `override-destination`, `parse-pure-ip` переключатели

---

## Task 37: Раздел «Профиль»

**Goal:** UI для верхнеуровневых полей (mode, log-level, external-controller, и т.д.).

**Files:**
- Create: `apps/web/src/pages/Profile.vue`
- Create: `apps/web/src/components/profile/ProfileForm.vue`

**Acceptance Criteria:**
- [ ] Все поля из spec §4 «Экран Профиль»
- [ ] `secret:` — masked-by-default с toggle-eye (secondary auth)

---

## Task 38: Раздел «Rule-providers»

**Goal:** UI для `rule-providers:`.

**Files:**
- Create: `apps/web/src/pages/Providers.vue`
- Create: `apps/web/src/components/providers/ProviderList.vue`
- Create: `apps/web/src/components/providers/ProviderForm.vue`
- Create: `apps/web/src/components/providers/InlineRulesEditor.vue`

**Acceptance Criteria:**
- [ ] Типы `http` / `file` / `inline`, форматы `mrs` / `yaml` / `text`
- [ ] `type: inline` — редактор правил built-in
- [ ] Кнопка «обновить сейчас» → `mihomo.refreshProvider(name)`

---

## Task 39: Raw YAML full-edit mode

**Goal:** Разблокировать edit в Monaco с clash-schema-hints.

**Files:**
- Modify: `apps/web/src/pages/RawYaml.vue`
- Create: `apps/web/src/components/yaml/MonacoYamlEdit.vue`
- Create: `apps/web/src/schemas/mihomo.schema.json` (JSON Schema для mihomo config)

**Acceptance Criteria:**
- [ ] Переключатель view/edit
- [ ] При невалидном YAML — UI блокирует структурные разделы (spec §4 fallback, P12 ревью)
- [ ] Кнопка «Применить» в edit-режиме

---

## Task 40: Tree-editor для AND/OR/NOT правил

**Goal:** Вложенный редактор составных правил.

**Files:**
- Create: `apps/web/src/components/services/LogicalRuleEditor.vue`
- Modify: `apps/web/src/components/services/RuleRow.vue` — включить редактирование для `kind: logical`

**Acceptance Criteria:**
- [ ] Дерево условий с drag-to-reorder
- [ ] Добавление AND/OR/NOT как узлов
- [ ] Лимит глубины 5 (sanity)
- [ ] Сериализация обратно в mihomo-формат `AND,((…),(…))` проверена тестами

---

## Task 41: User-defined invariants

**Goal:** Дать пользователю описать свои инварианты (для нашего роутера — 15 штук из CLAUDE.md).

**Files:**
- Create: `packages/shared/src/linter/invariants-user.ts`
- Create: `apps/server/src/routes/invariants.ts` — CRUD
- Create: `apps/web/src/pages/Invariants.vue` (sub-tab в Настройки)

**Acceptance Criteria:**
- [ ] Формат YAML-файла `MIHARBOR_DATA_DIR/invariants.yaml` такой же как `invariants-universal.json`
- [ ] UI для add/edit/delete
- [ ] Пример-импорт для common setups

---

## Task 42: Linter 4 — service templates suggester

**Goal:** База ~200 сервисов + fuzzy-match.

**Files:**
- Create: `packages/shared/src/templates/services.json` (~200 сервисов)
- Create: `packages/shared/src/linter/templates-matcher.ts`
- Create: `apps/web/src/components/services/TemplateSuggester.vue`

**Acceptance Criteria:**
- [ ] База содержит минимум 50 ключевых (Spotify, YouTube, Telegram, OpenAI, ChatGPT, Notion, Discord, ...)
- [ ] Fuzzy-match по name+aliases (Fuse.js)
- [ ] При добавлении нового сервиса в UI появляется dropdown «предложения»

---

## Task 43: Linter 5 — auto-placement

**Goal:** Автоматическая вставка правила в правильный блок.

**Files:**
- Create: `packages/shared/src/linter/placement.ts`
- Modify: `apps/web/src/components/services/AddRuleDialog.vue` — используем placement-hint

**Acceptance Criteria:**
- [ ] Эвристика блоков: ads → private → RU → services → CDN → match
- [ ] При добавлении правила UI предлагает индекс с объяснением

---

## Task 44: SshTransport

**Goal:** Локальный режим работы на Mac с SSH до сервера.

**Files:**
- Create: `apps/server/src/transport/ssh.ts`
- Create: `apps/server/src/lock/ssh-lock.ts`
- Create: `apps/server/tests/transport/ssh.test.ts` (mock ssh через `ssh2-mock`)
- Create: `docs/SSH_SETUP.md`

**Acceptance Criteria:**
- [ ] Поддержка `ssh-agent` + unencrypted key + passphrase (ENV)
- [ ] Атомарная запись через tmp-on-target-mount
- [ ] SSH-lock через `flock -xn /etc/mihomo/.miharbor.lock`
- [ ] `runMihomoValidate` через `ssh exec` + wrapper-script

**Verify:** `MIHARBOR_TRANSPORT=ssh bun run server:dev` + SSH до реального тестового сервера (не production роутера!) → deploy-pipeline работает.

---

## Task 45: RU-локализация (полная)

**Goal:** Все i18n-ключи переведены.

**Files:**
- Modify: `apps/web/src/i18n/ru.json`
- Modify: `packages/shared/src/i18n/ru.json`

**Acceptance Criteria:**
- [ ] 100% ключей переведены (скрипт-валидатор в CI)
- [ ] Человеческий перевод (не Google Translate для линтер-сообщений)
- [ ] Переключатель EN/RU работает во всех разделах

---

## Task 46: Compatibility matrix + CI e2e per mihomo version

**Goal:** Расширить CI матрицей mihomo версий.

**Files:**
- Modify: `.github/workflows/ci.yml`

**Acceptance Criteria:**
- [ ] E2E job запускается для mihomo `1.18.0`, `1.19.0`, `1.20.0-alpha.x`
- [ ] Результаты в README «Compatibility matrix» обновляются автоматически

---

## Task 47-52: Полировка

Следующие мелкие задачи (заполняются из feedback MVP + review стейджа 2):
- UX-фиксы на Services/Proxies найденные в реальной эксплуатации
- Ускорение Monaco (lazy load)
- Улучшение error-messages (контекстные подсказки)
- Accessibility (a11y — aria, keyboard navigation)
- Test coverage ≥80% на server-side

---

## Task 53: Release v0.2.0

**Acceptance Criteria:**
- [ ] Все задачи этапа `completed`
- [ ] CI зелёный на всех mihomo-версиях matrix
- [ ] Smoke + e2e + manual dogfood на dev-роутере
- [ ] **Migration-safety test**: развернуть v0.1.0 → создать 5 снапшотов с реальными секретами → upgrade на v0.2.0 → проверить что `GET /api/snapshots` возвращает все 5, `POST /api/snapshots/<id>/rollback` успешен, все секреты из vault resolve'ятся
- [ ] Downgrade test: обратная миграция v0.2.0 → v0.1.0 не портит data-volume (документируем что теряется, что нет)
- [ ] `git tag v0.2.0`
