# Geo-каталог, просмотр ожидающих изменений и фикс WG public-key (v0.2.5 UX)

**Дата:** 2026-04-18
**Статус:** Draft (v2 после code review)
**Owner:** Matrix

## Контекст

Пользователь на релизе v0.2.4 сообщил о трёх проблемах UX:

1. В `RuleEditor.vue` для типов `GEOSITE` / `GEOIP` / `SRC-GEOIP` отображается обычный `<Input>` со свободным вводом. Пользователь не видит, какие категории вообще доступны в его `.dat` файлах, и рискует опечататься в имени (ошибки всплывут только на deploy).
2. В `Header.vue` бейдж "1 изменение" недоступен для клика. Нет способа (а) посмотреть, что именно сейчас лежит в draft'е относительно живого конфига, и (б) сбросить всё и перегенерировать draft из нетронутого mihomo-конфига. Дополнительно: счётчик всегда "1", потому что `dirtyCount` в `apps/web/src/stores/config.ts:172-176` — бинарный (`draftText === rawLive ? 0 : 1`), не настоящий подсчёт строк.
3. В `WireGuardForm.vue` при редактировании существующего WG-узла поле `public-key` заполняется строкой `$MIHARBOR_VAULT:<uuid>` вместо реального публичного ключа. Валидатор `isValidWireGuardKey` отвергает sentinel, форма неизменяема. Корневая причина: `public-key` одновременно в `DEFAULT_SECRET_FIELDS` (`apps/server/src/vault/mask.ts:38`) и матчится суффиксом `-key`; `WireGuardForm` читает из `config.proxies` → `draftProxies` → парсинг masked draft, поэтому видит sentinel.

## Цели

- Дать визуальный селектор категорий для `GEOSITE` / `GEOIP` / `SRC-GEOIP` со свободным вводом как fallback.
- Сделать бейдж в Header'е кликабельным; в модалке — unified diff + кнопка полного сброса draft'а. Убрать обманчивую метку "1 изменение".
- Устранить попадание `$MIHARBOR_VAULT:<uuid>` в поле `public-key` формы WG.

## Не-цели

- Семантическая сводка diff'а ("добавлено правило X в сервис Y") — вне MVP.
- Частичный / посекционный сброс draft'а — пользователь явно попросил полный.
- Undo последнего изменения — не обсуждалось.
- Автообновление geo-каталога по расписанию — ручной refresh достаточен.
- Поддержка MMDB-режима (`geodata-mode: false`) в селекторе — UI падает на free-form input, когда каталог недоступен. См. §1 "Edge cases".

---

## Секция 1 — Селектор GEOSITE/GEOIP

### Источник данных

Сервер сам скачивает и парсит `.dat`-файлы mihomo.

**Резолюция URL** (`apps/server/src/catalog/geo-source.ts`):

1. Читаем текущий `profile.geox-url.geosite` / `profile.geox-url.geoip` из live config через `parseDocument(transport.readConfig())`.
2. Если поле пустое или отсутствует — fallback на **реальные** mihomo defaults из `MetaCubeX/mihomo/config/config.go:DefaultRawConfig()`:

   - GEOIP: `https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat`
   - GEOSITE: `https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat`

   Константы выделить в `apps/server/src/catalog/defaults.ts` с JSDoc-комментарием, ссылающимся на upstream mihomo (для будущих апдейтов): `// Source: MetaCubeX/mihomo config/config.go — DefaultRawConfig().GeoXUrl.`

3. MMDB / ASN не парсим — рулами `GEOIP,<code>` / `GEOSITE,<name>` работают только против `geoip.dat` / `geosite.dat` даже при `geodata-mode: false`. В режиме MMDB mihomo берёт те же имена стран, поэтому список из `geoip.dat` остаётся применимым.

### Парсинг .dat

V2Ray/mihomo geo-файлы — это простой protobuf:

```proto
message GeoIPList     { repeated GeoIP     entry = 1; }
message SiteGroupList { repeated SiteGroup entry = 1; }

message GeoIP     { string country_code = 1; repeated CIDR   cidr   = 2; ... }
message SiteGroup { string country_code = 1; repeated Domain domain = 2; ... }
```

Нам нужно ТОЛЬКО поле 1 (`country_code`) каждого top-level `Entry`. Пишем минимальный декодер `apps/server/src/catalog/pb-scan.ts` на ~70 строк:

- Читаем wire-format: varint-тег + length-delimited payload.
- На уровне top-level: каждый `entry` = tag `1` + varint длина + байты вложенного сообщения.
- Внутри вложенного сообщения находим первое поле `1` (string, wire type 2), читаем UTF-8 строку, остальные поля пропускаем через `skipField(tag, reader)`.
- Возвращаем `string[]` (имена в том же порядке, в котором они в файле — сортировка на UI-слое).

В шапке файла — комментарий со ссылкой на [v2ray-core proto](https://github.com/v2fly/v2ray-core/blob/master/app/router/config.proto) и ASCII-схема wire-format байтов первых трёх entries, чтобы будущий maintainer мог сверить.

Почему не `protobufjs`: добавит ~200 KB в server-bundle; runtime сам по себе оверкилл для одного string-поля.

### Парсинг-фикстура

`apps/server/tests/catalog/fixtures/build-fixture.ts` — helper, который пишет маленький `.dat`-файл на 3 entries через сырые varint + length-delimited байты. Коммитится и helper, и сгенерированный бинарник (`geoip.tiny.dat`, `geosite.tiny.dat`). Это:

- Не трогает и не копирует данные из реальных `.dat` (чистые custom-имена типа `test-alpha`, `test-beta`).
- Позволяет в `pb-scan.test.ts` запустить `pbScan(readFileSync('.../geoip.tiny.dat'))` и сравнить с `['test-alpha', 'test-beta', 'test-gamma']`.
- Документирует для читателя байтовую раскладку файла.

### Canonicalization

Что комбобокс эмитит в `update:modelValue` после выбора или свободного ввода:

- **GEOIP** (и `SRC-GEOIP`) — `value.toUpperCase()`. Это соответствует конвенции в golden fixture (`apps/server/tests/fixtures/config-golden.yaml:273`: `GEOIP,RU`) и человекочитаемому виду. Линтер в `packages/shared/src/linter/placement.ts:91-99` уже case-insensitive, так что миграция безопасна.
- **GEOSITE** — значение сохраняется as-is. Категории в `dlc.dat` / `geosite.dat` всегда lowercase (`youtube`, `category-ru`), но кастомные `.dat` могут использовать любой регистр — не нормализуем.

Подсказки регистра в `GeoCatalogCombobox.vue` — placeholder `Напр. RU` для GEOIP, `Напр. youtube` для GEOSITE.

### Кэш

In-memory LRU-подобный кэш `apps/server/src/catalog/geo-cache.ts`:

```ts
interface CacheEntry {
  url: string
  fetched: Date
  entries: string[]
  etag?: string
}

interface CacheMiss {
  url: string
  error: string
}
```

- Ключ — `url`. TTL 24h. Максимум 8 записей (hedge против частой смены URL в профиле).
- **First-time fetch failure**: `entries: []`, `fetched: null`, `error: "<message>"` — эндпоинт всё равно возвращает 200 со структурой ниже. UI увидит `error !== null` и перейдёт на free-form ввод, НЕ падая.
- **Stale-on-error**: если есть прошлый успешный `CacheEntry`, возвращаем его `entries` + проставляем `error: "<message>"`.
- Force-refresh — `?refresh=1` на route.

### Эндпоинт

`GET /api/catalog/geo`:

```jsonc
{
  "geosite": {
    "entries": ["google", "youtube", "category-ru", ...],
    "source": "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat",
    "fetched": "2026-04-18T10:00:00.000Z", // null при first-time failure
    "error": null // string при любой ошибке
  },
  "geoip": {
    "entries": ["RU", "CN", "US", "PRIVATE", ...],
    "source": "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat",
    "fetched": "2026-04-18T10:00:00.000Z",
    "error": null
  }
}
```

- Ответ всегда 200 — ошибка сети для одной базы не валит другую, каждая ветка (`geosite`/`geoip`) имеет свой независимый `error`.
- Заголовок ответа — `Cache-Control: max-age=300`. Избегаем хаммеринга при перезагрузках; 5 минут — компромисс между свежестью и тишиной dev-лога. Сервер-сайд кэш (24h) — независимый уровень.
- **GEOIP** значения нормализуются к `.toUpperCase()` в ответе сервера (единый источник истины; UI не делает свою нормализацию).
- Роут регистрируется в `server-bootstrap.ts` с тем же `basic-auth` middleware, что и остальные `/api/*` — эндпоинт НЕ public.

### UI

Новый компонент `apps/web/src/components/services/GeoCatalogCombobox.vue`:

**Props:** `modelValue: string`, `type: 'GEOSITE' | 'GEOIP'`, `placeholder?: string`.
**Emits:** `update:modelValue`, `blur`.

**Поведение:**

- Тянет `useCatalogStore().ensureLoaded()` on mount (no-op если уже загружено/загружается).
- Инпут + выпадающий popover со списком.
- Fuzzy match (простой — `v.toLowerCase().includes(q.toLowerCase())`, топ-10). Для GEOIP пользовательский ввод нормализуется к uppercase при потере фокуса.
- ↑/↓ — навигация по dropdown; Enter — выбор; Esc — закрыть dropdown.
- Свободный ввод разрешён: любое значение, которое пользователь оставляет в инпуте, сохраняется. Кастомные `.dat` могут содержать категории, которых нет в каталоге.
- Если `useCatalogStore().error[type] !== null` — показываем небольшой `⚠` badge "offline" с tooltip (текст ошибки); dropdown не открывается; инпут работает как обычный текстовый.
- Если `entries.length === 0 && error === null && !loading` — пустое состояние с hint'ом "Каталог недоступен в этом режиме" (актуально если URL profile пуст и дефолт тоже отдал 0 entries из-за повреждённого `.dat`).
- Кнопка `↻` сбоку для force-refresh (вызывает `?refresh=1`).

**Store:** `apps/web/src/stores/catalog.ts`:

```ts
export const useCatalogStore = defineStore('catalog', () => {
  const geosite = ref<string[]>([])
  const geoip = ref<string[]>([])
  const loading = ref(false)
  const error = ref<{ geosite: string | null; geoip: string | null }>({
    geosite: null,
    geoip: null,
  })
  const loaded = ref(false)
  let inflight: Promise<void> | null = null
  async function ensureLoaded(): Promise<void> {
    if (loaded.value || inflight) return inflight ?? undefined
    inflight = doLoad(false)
    await inflight
    inflight = null
  }
  async function refresh(): Promise<void> {
    /* doLoad(true) */
  }
  async function doLoad(force: boolean) {
    /* GET /api/catalog/geo[?refresh=1] */
  }
  return { geosite, geoip, loading, error, loaded, ensureLoaded, refresh }
})
```

Дедупликация через `inflight` критична — иначе одновременное открытие двух комбобоксов (GEOSITE и GEOIP) сделает два запроса.

**Интеграция в `RuleEditor.vue`:**

```vue
<GeoCatalogCombobox
  v-if="type === 'GEOSITE' || type === 'GEOIP' || type === 'SRC-GEOIP'"
  v-model="value"
  :type="type === 'SRC-GEOIP' ? 'GEOIP' : type"
/>
<Input v-else v-model="value" ... />
```

### Тесты

- `apps/server/tests/catalog/pb-scan.test.ts` — против `geoip.tiny.dat` + `geosite.tiny.dat` фикстур.
- `apps/server/tests/catalog/geo-cache.test.ts` — TTL, stale-on-error, first-fetch-failure возвращает `entries: []`, force-refresh инвалидирует.
- `apps/server/tests/catalog/geo-source.test.ts` — `profile.geox-url.geosite` пустая → дефолт; `geox-url: undefined` в документе → дефолты; заданная пользователем URL → она и используется.
- `apps/server/tests/routes/catalog.test.ts` — GET возвращает обе ветки; частичная ошибка (geosite ok, geoip down); `?refresh=1` миммикирует cache-bust; неавторизованный запрос → 401 (проверка middleware подцеплен).
- `apps/web/tests/catalog-combobox.spec.ts` — type-ahead, keyboard nav, GEOIP uppercase-on-blur, fallback при error, свободный ввод, дедупликация через `ensureLoaded`.
- `apps/web/tests/rule-editor-geo.spec.ts` — при GEOSITE/GEOIP/SRC-GEOIP подставляется combobox, при IP-CIDR — Input.

---

## Секция 2 — Просмотр ожидающих изменений и полный сброс

### Источник diff'а — сервер

Старый DiffViewer в `apps/web/src/components/layout/DiffViewer.vue` (placeholder) НЕ используем. Клиентского `diff` в `apps/web/package.json` нет; `diff2html` только рендерит патч. Генерируем патч на сервере — там уже живёт `apps/server/src/deploy/diff.ts:unifiedDiff`, который возвращает `{ patch, added, removed }`. Переиспользуем его, чтобы не добавлять клиентскую зависимость и не дублировать логику counting `+`/`-` строк.

**Новый эндпоинт** `apps/server/src/routes/config.ts`:

```ts
.get('/draft/diff', async ({ request }) => {
  const user = getAuthUser(request) ?? 'anonymous'
  const draftEntry = deps.draftStore.get(user)
  const liveMasked = await maskedLiveText()
  const draftMasked = draftEntry?.text ?? liveMasked
  const { patch, added, removed } = unifiedDiff(liveMasked, draftMasked, {
    from: 'live',
    to: 'draft',
  })
  return { patch, added, removed, hasDraft: draftEntry !== null }
})
```

Обе стороны diff'а — **masked** (ту же masked версию `rawLive` и draft из store). Значит:

- Vault sentinel'ы одинаковые на обеих сторонах для неизменённых секретов (благодаря per-hash memo в `maskedLiveText`), не создают шума.
- Если пользователь вводил секрет в draft через структурную форму (напр. новый `private-key`), draft HTTP-cycle уже зашёл в `vault.maskDoc` перед сохранением — в store лежит sentinel, не plaintext. Значит в diff'е тоже sentinel. Утечки секрета на экран не будет.
- Исключение: Raw YAML редактор, в который пользователь может влепить plaintext и сохранить. Это уже существующий trust-level — если пользователь явно редактирует raw YAML, он видит свои же значения.

**Клиентский API** — `apps/web/src/api/client.ts` получает `endpoints.config.draftDiff()`.

### Модалка `PendingChangesDialog.vue`

**Расположение:** `apps/web/src/components/layout/PendingChangesDialog.vue`.

**Props:** `open: boolean`, `v-model:open`.

**Поведение:**

- On `open` === `true` → вызывает `draftDiff()`.
- Пока запрос летит — `loading` skeleton.
- На успехе — рендерит `patch` через `diff2html` (повторяем паттерн из `apps/web/src/components/history/SnapshotDiffDrawer.vue`: ленивый `await import('diff2html')`, минимальный CSS-subset инлайн).
- На failure — инлайн error banner с текстом ошибки + кнопка "Попробовать снова".

**Содержимое:**

- Header: "Ожидающие изменения" + `Badge` "+{added} / −{removed}" (из ответа сервера; не считаем сами).
- Body:
  - `hasDraft === false` (граничный случай — клик на бейдж в момент race) → "Изменений нет".
  - Иначе — diff2html render.
- Footer:
  - `[Сбросить все изменения]` — `variant="destructive"`, `size="sm"`. Disabled при `hasDraft === false` или `loading`. Click → открыть вложенный `ConfirmDialog`:
    - Title: "Сбросить локальные правки?"
    - Body: "Все изменения будут удалены. Draft снова будет собран из актуального mihomo-конфига. Действие необратимо."
    - Confirm: "Сбросить" (destructive).
  - На confirm: `await config.clearDraft(); emit('update:open', false)`. `loadAll()` НЕ нужен — `clearDraft` уже пересеивает `draftText` из `rawLive` (`apps/web/src/stores/config.ts:397-407`). Если хотим гарантированно подтянуть свежий live (редкий случай — внешняя правка файла между load и reset), добавляем `void config.loadAll()` в fire-and-forget (без await).
  - `[Закрыть]` — `variant="outline"`.

### Бейдж в Header

`apps/web/src/components/layout/Header.vue`:

- Старый `header.changes_count` с плюрал-формой **удаляется** — `dirtyCount` бинарный и обманчивый. Заменяем на два состояния:
  - `dirtyCount === 0` → `Badge variant="muted"` `header.no_changes` (без изменений — как сейчас).
  - `dirtyCount === 1` → `<button>`-обёртка над `Badge variant="secondary"` с текстом `header.pending_changes` ("Ожидающие изменения", без числа). Click → открывает модалку. Tooltip — `header.pending_tooltip` ("Показать изменения").
- Кнопка disabled пока `rawLive === null || draftText === null` (initial load race).
- Ключи `header.changes_count`, `header.apply_tooltip_empty`, `header.apply_tooltip_ready` — `changes_count` удаляется, два `apply_tooltip*` остаются.

### i18n

Добавить в `apps/web/src/i18n/{en,ru}.json`:

```jsonc
// en.json
"header": {
  "pending_changes": "Pending changes",
  "pending_tooltip": "Show changes"
},
"pending_changes": {
  "title": "Pending changes",
  "stats": "+{added} / −{removed}",
  "no_changes": "No changes",
  "loading": "Loading diff…",
  "retry": "Retry",
  "reset_button": "Reset all changes",
  "reset_confirm_title": "Reset local edits?",
  "reset_confirm_body": "All changes will be discarded. The draft will be re-seeded from the current mihomo config. This cannot be undone.",
  "reset_confirm_action": "Reset",
  "close": "Close"
}
```

Русские формулировки — из секций 2 выше, плюс `"loading": "Загрузка диффа…"`, `"retry": "Повторить"`.

Удаляем: `header.changes_count` (обе локали).

### Тесты

- `apps/server/tests/routes/config.test.ts` — новый кейс: GET `/draft/diff` без draft → `hasDraft: false`, `patch === ''`, `added === 0`, `removed === 0`; с draft → `hasDraft: true`, корректные `added/removed`, обе стороны masked.
- `apps/web/tests/pending-changes-dialog.spec.ts`:
  - Mount с `open=true` → вызов `draftDiff`, skeleton → diff2html render → +X/−Y в заголовке.
  - `hasDraft=false` → "Изменений нет".
  - Error from server → error banner + retry.
  - Click "Сбросить" → ConfirmDialog → confirm → `clearDraft` вызван, `update:open` false.
- `apps/web/tests/header.spec.ts` — бейдж кликабелен только когда `dirtyCount === 1`; disabled при null rawLive/draftText; при клике открывает модалку.

---

## Секция 3 — Фикс vault-sentinel в `public-key` WG

### Фикс в `apps/server/src/vault/mask.ts`

Добавить **negative list**, проверяющийся ПЕРЕД точным матчем и suffix-match:

```ts
/** Keys that LOOK like secrets (match `-key` suffix or exact name) but are
 *  explicitly NOT confidential — checked before `DEFAULT_SECRET_FIELDS` and
 *  `SECRET_SUFFIXES`. Public keys are by definition publishable; vaulting
 *  them only hides them from the UI form and breaks validation. */
export const KNOWN_NON_SECRET_KEYS = Object.freeze(['public-key'])

/** `true` iff `key` is recognised as a secret-bearing field.
 *  Precedence: negative list → exact match → suffix match. */
export function isSecretKey(key: string, fields: Set<string>): boolean {
  if (KNOWN_NON_SECRET_KEYS.includes(key)) return false
  if (fields.has(key)) return true
  for (const suf of SECRET_SUFFIXES) {
    if (key.endsWith(suf)) return true
  }
  return false
}
```

Удаляем `'public-key'` из `DEFAULT_SECRET_FIELDS` — чистота; поле не должно быть в списке секретов изначально.

**Нейминг** — `KNOWN_NON_SECRET_KEYS` (не `SECRET_ALLOW_LIST`), чтобы на call-site смысл был самоочевиден: "белый список ключей, которые только ВЫГЛЯДЯТ как секреты".

### Rollback / snapshots

Проверено в `apps/server/src/deploy/rollback.ts:67-73` и `apps/server/src/vault/vault.ts:245-269`:

- `rollback` делает `parseDocument(configMasked)` → `vault.unmaskDoc(doc)` → кормит в `runPipeline` как новый draft.
- `unmaskDoc` обходит все `Pair` и заменяет sentinel → uuid lookup; **НЕ фильтрует по `isSecretKey`**. Значит legacy snapshot с `public-key: $MIHARBOR_VAULT:<uuid>` раскрутится корректно.
- Uuid остаётся в vault с `referenced_by: [<snapshot_id>]`. `vault.gc()` его не прибивает (смотри `gc()` реализацию).

**Инвариант для implementer'а:** `unmaskDoc` не изменяется этой задачей; никаких if-гвардов по `isSecretKey` в нём не появляется. Legacy snapshots остаются читаемыми вплоть до следующего перезаписывания (тогда `maskDoc` по новому правилу оставит `public-key` в открытом виде, а старый uuid станет unreferenced и будет подобран следующим `gc`).

### Миграция живого draft'а (on-read)

Draft'ы, сохранённые ДО релиза, имеют `public-key: $MIHARBOR_VAULT:<uuid>`. Чтобы после апгрейда форма заработала немедленно (не дожидаясь перезаписи draft'а пользователем), добавляем on-read миграцию в `apps/server/src/routes/config.ts` — GET `/draft`:

```ts
.get('/draft', async ({ request }) => {
  const user = getAuthUser(request) ?? 'anonymous'
  const draft = deps.draftStore.get(user)
  if (draft) {
    const { text: migrated, touched } = await migrateDraftPublicKeys(draft.text, deps.vault, deps.logger)
    if (touched && migrated !== draft.text) {
      const entry = deps.draftStore.put(user, migrated)
      return { source: 'draft' as const, text: migrated, updated: entry.updated }
    }
    return { source: 'draft' as const, text: draft.text, updated: draft.updated }
  }
  const text = await maskedLiveText()
  return { source: 'current' as const, text }
})
```

**`migrateDraftPublicKeys` (`apps/server/src/vault/migrate-public-keys.ts`):**

```ts
export async function migrateDraftPublicKeys(
  text: string,
  vault: Vault,
  logger: Logger,
): Promise<{ text: string; touched: boolean }>
```

- Парсит `text` как yaml Document. Если не распарсился — возвращает `{ text, touched: false }` (не чиним сломанное).
- `visit` по паттерну: `Pair.key.value === 'public-key'` И `Pair.value` — scalar string, startsWith `SENTINEL_PREFIX`.
- Для каждого такого узла: `uuid = v.slice(SENTINEL_PREFIX.length)` → `vault.resolve(uuid)`:
  - Success → перезаписываем scalar реальным значением, `touched = true`.
  - `null` (vault не знает uuid) → оставляем sentinel как есть, пишем `logger.warn({ uuid, key: 'public-key' }, 'migrate: unknown vault uuid — leaving sentinel')` + инкремент `auditLog` счётчика `migrate.public_keys.unknown_uuid`. Не кидаем — не хотим ломать GET /draft.
- Возвращаем `{ text: doc.toString(), touched }`.

**Performance.** `vault.resolve(uuid)` — `readPayload()` на каждый вызов (полный decrypt). Для draft'ов с многими WG-peer'ами это заметно. Поэтому `migrateDraftPublicKeys` сам читает vault payload ОДИН раз через экспортируемый `vault.listEntries()` (новый метод, см. ниже) и резолвит uuid'ы из in-memory Map. Если не хотим расширять интерфейс Vault — делаем первый resolve, потом второй и так далее (acceptable для N ≤ 3 peer'ов — типовой случай).

**Расширение `Vault` (минимальное):**

```ts
// в apps/server/src/vault/vault.ts
export interface Vault {
  // ... existing methods ...
  /** Batch resolve — reads the vault payload ONCE, returns a map.
   *  Missing uuids are absent from the map (no throw). */
  resolveMany(uuids: Iterable<string>): Promise<Map<string, string>>
}
```

Реализация — один `readPayload()` + цикл по uuid'ам. Лучше сразу с API в таком виде, без приватных экспортов.

**Гонка на concurrent GET /draft.** Два параллельных запроса от одного пользователя могут обе запустить миграцию. Идемпотентно: результат `migrateDraftPublicKeys(текст)` детерминирован (тот же payload, тот же output). Защита — условие `if (touched && migrated !== draft.text)` в роуте: если за время нашего вычисления другой запрос уже записал migrated-версию в `draftStore`, наш `draft.text !== migrated` становится ложью, мы НЕ пишем повторно. `updated` jitter устранён.

**Vault bookkeeping.** Миграция НЕ вызывает `vault.gcSet` / `vault.gc`. Uuid остаётся в vault'е с существующими `referenced_by` (snapshot references). Это критично для работы rollback — если старый snapshot ссылается на uuid, тот обязан существовать. Явный comment в реализации: `// Do NOT gc migrated uuids: snapshots may still reference them.`

### Наблюдаемость

- `logger.info({ migrated_keys: touched }, 'draft.migrate.public_keys')` при `touched === true` — раз в жизнь draft'а, объёма лога не раздувает.
- Audit-log event `migrate.public_keys` с `{ user, count }` (`apps/server/src/observability/audit-log.ts` — ищем существующий паттерн и дополняем).

### Deploy pipeline

`apps/server/src/deploy/pipeline.ts` — **без изменений**. `unmaskDoc` uuid-driven, а не key-name-driven, поэтому legacy draft'ы и snapshot'ы остаются корректными. В спек'е выделить это явно, чтобы implementer не пытался добавить если-гвард по `isSecretKey`.

### Существующие тесты, которые ЛОМАЮТСЯ и требуют обновления контракта

- `apps/server/tests/vault/mask.test.ts`:
  - Тест `DEFAULT_SECRET_FIELDS contains the spec-required keys` (строка 18) — удалить `'public-key'` из `expected` массива.
  - Тест `walkSecrets replaces WireGuard private-key + public-key + pre-shared-key` (строка 78) — переименовать в `walkSecrets replaces WireGuard private-key + pre-shared-key`, ожидать `replacements.toHaveLength(2)` (не 3); убрать ассерт `not.toContain(...)` для public-key значения — оно должно остаться в тексте.
- Комментарий в `apps/server/src/config/views/proxies.ts:5-19` — подправить: секция "Secret masking (v0.2.4)" упоминает только private-key и pre-shared-key, не требует изменений; но ссылочная фраза про "other password-shaped fields" корректна.

### Новые тесты

- `apps/server/tests/vault/mask.test.ts` — регрессионный кейс: `public-key: abcd123=...` не маскируется даже через суффикс `-key`. Плюс sanity: `private-key`, `pre-shared-key`, `auth-token`, `db-password`, `custom-secret`, `wg-key` (неизвестный ключ с суффиксом `-key`) — всё ещё маскируются.
- `apps/server/tests/vault/migrate-public-keys.test.ts`:
  - Draft с одним `public-key: $MIHARBOR_VAULT:<uuid>` где vault знает uuid → реальный ключ, `touched: true`.
  - Draft с несколькими vaulted public-key → все резолвятся одним проходом (проверяем через spy на `vault.resolveMany`, что вызван один раз).
  - Draft без sentinel'ов → `touched: false`, текст побайтно равен входу.
  - Draft где vault вернул `null` → sentinel сохранён, warn-log есть, `touched: true` ТОЛЬКО если были другие успешные замены в том же draft.
  - Invalid YAML на входе → `{ text: input, touched: false }`, не падает.
  - Идемпотентность: повторный вызов над результатом → `touched: false`.
- `apps/server/tests/routes/config.test.ts`:
  - GET `/draft` с legacy sentinel'ами → разрезолвленный ключ; повторный GET возвращает то же без повторной записи (spy на `draftStore.put` — не зовётся во втором вызове).
- `apps/server/tests/vault/vault.test.ts` — кейс для `resolveMany`: unknown uuids просто отсутствуют в выходном Map'е.

---

## План тестового покрытия

Baseline coverage (последний коммит): **89.98 %**. Новый код — парсер + кэш + routes + combobox + модалка + миграция + `resolveMany` — весь покрывается unit/e2e выше, включая явные "vault не знает uuid" и "первый fetch упал" branches. Целевой baseline после мержа — **≥ 89.5 %**.

## Пофайловый перечень изменений

**Server:**

- `apps/server/src/catalog/defaults.ts` — новый (mihomo default URLs, JSDoc-ссылка на upstream)
- `apps/server/src/catalog/pb-scan.ts` — новый
- `apps/server/src/catalog/geo-source.ts` — новый
- `apps/server/src/catalog/geo-cache.ts` — новый
- `apps/server/src/routes/catalog.ts` — новый
- `apps/server/src/server-bootstrap.ts` — подключить `catalogRoutes` с basic-auth middleware
- `apps/server/src/vault/mask.ts` — `KNOWN_NON_SECRET_KEYS` + удалить `public-key` из defaults
- `apps/server/src/vault/vault.ts` — новый метод `resolveMany`
- `apps/server/src/vault/migrate-public-keys.ts` — новый
- `apps/server/src/routes/config.ts` — миграция on-read в GET `/draft` + новый GET `/draft/diff`
- `apps/server/src/observability/audit-log.ts` — новый event `migrate.public_keys` (если паттерн существует)

**Client:**

- `apps/web/src/api/client.ts` — эндпоинты `catalog.geo`, `config.draftDiff`
- `apps/web/src/stores/catalog.ts` — новый
- `apps/web/src/components/services/GeoCatalogCombobox.vue` — новый
- `apps/web/src/components/services/RuleEditor.vue` — подключить combobox
- `apps/web/src/components/layout/PendingChangesDialog.vue` — новый
- `apps/web/src/components/layout/Header.vue` — кликабельный бейдж, disable при загрузке, подключить модалку, удалить `header.changes_count`
- `apps/web/src/i18n/en.json`, `apps/web/src/i18n/ru.json` — новые ключи, удалить `header.changes_count`
- `apps/web/src/components/layout/DiffViewer.vue` — УДАЛИТЬ (placeholder, больше не используется — grep: consumers нет)

**Tests:**

- `apps/server/tests/catalog/fixtures/build-fixture.ts` + `.tiny.dat` бинарники
- `apps/server/tests/catalog/pb-scan.test.ts`, `geo-cache.test.ts`, `geo-source.test.ts` — новые
- `apps/server/tests/routes/catalog.test.ts` — новый
- `apps/server/tests/vault/mask.test.ts` — обновлённые контракты + новые регрессии
- `apps/server/tests/vault/vault.test.ts` — `resolveMany`
- `apps/server/tests/vault/migrate-public-keys.test.ts` — новый
- `apps/server/tests/routes/config.test.ts` — GET `/draft` миграция, GET `/draft/diff`
- `apps/web/tests/catalog-combobox.spec.ts`, `rule-editor-geo.spec.ts` — новые
- `apps/web/tests/pending-changes-dialog.spec.ts` — новый
- `apps/web/tests/header.spec.ts` — дополнен / новый

## Порядок реализации

1. **Секция 3 (WG public-key)** — независимо, быстро, разблокирует пользователя. Фикс + миграция + тесты.
2. **Секция 2 (просмотр + reset)** — новый server-side endpoint переиспользует `unifiedDiff`, без клиентских deps.
3. **Секция 1 (geo-каталог)** — объёмнее: parser + cache + endpoint + combobox.

Каждая секция — отдельный commit / PR.
