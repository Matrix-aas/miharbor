# Geo-каталог, просмотр ожидающих изменений и фикс WG public-key (v0.2.5 UX)

**Дата:** 2026-04-18
**Статус:** Draft
**Owner:** Matrix

## Контекст

Пользователь на релизе v0.2.4 сообщил о трёх проблемах UX:

1. В `RuleEditor.vue` для типов `GEOSITE` / `GEOIP` / `SRC-GEOIP` отображается обычный `<Input>` со свободным вводом. Пользователь не видит, какие категории вообще доступны в его `.dat` файлах, и рискует опечататься в имени (ошибки всплывут только на deploy).
2. В `Header.vue` бейдж "N изменений" недоступен для клика. Нет способа (а) посмотреть, что именно сейчас лежит в draft'е относительно живого конфига, и (б) сбросить всё и перегенерировать draft из нетронутого mihomo-конфига.
3. В `WireGuardForm.vue` при редактировании существующего WG-узла поле `public-key` заполняется строкой `$MIHARBOR_VAULT:<uuid>` вместо реального публичного ключа. Валидатор `isValidWireGuardKey` отвергает sentinel, форма неизменяема. Риск: пользователь тайпает реальный ключ поверх → в draft попадает валидный base64, но при deploy sentinel в остальных местах уже не резолвится — либо пользователь сдаётся и не может сохранить.

## Цели

- Дать визуальный селектор категорий для `GEOSITE` / `GEOIP` / `SRC-GEOIP` со свободным вводом как fallback.
- Сделать бейдж `N изменений` кликабельным; в модалке — unified diff + кнопка полного сброса draft'а.
- Устранить попадание `$MIHARBOR_VAULT:<uuid>` в поле `public-key` формы WG.

## Не-цели

- Семантическая сводка diff'а ("добавлено правило X в сервис Y") — вне MVP.
- Частичный / посекционный сброс draft'а — пользователь явно попросил полный.
- Undo последнего изменения — не обсуждалось.
- Автообновление geo-каталога по расписанию — ручной refresh достаточен.

---

## Секция 1 — Селектор GEOSITE/GEOIP

### Источник данных

Сервер сам скачивает и парсит `.dat`-файлы mihomo.

**Резолюция URL** (`apps/server/src/catalog/geo-source.ts`):

1. Читаем текущий `profile.geox-url.geosite` / `profile.geox-url.geoip` из live config через `parseDocument(readConfig())`.
2. Если поле пустое или отсутствует — fallback на дефолты:
   - GEOIP: `https://github.com/MetaCubeX/meta-rules-dat/releases/latest/download/geoip.dat`
   - GEOSITE: `https://github.com/v2fly/domain-list-community/releases/latest/download/dlc.dat`
3. MMDB / ASN не трогаем — для селектора имён не нужны (код страны в GEOIP и так есть).

### Парсинг .dat

V2Ray/mihomo geo-файлы — это простой protobuf:

```proto
message GeoIPList   { repeated GeoIP     entry = 1; }
message SiteGroupList { repeated SiteGroup entry = 1; }

message GeoIP       { string country_code = 1; repeated CIDR   cidr  = 2; ... }
message SiteGroup   { string country_code = 1; repeated Domain domain = 2; ... }
```

Нам нужно ТОЛЬКО поле 1 (`country_code`) каждого top-level `Entry`. Пишем минимальный декодер `apps/server/src/catalog/pb-scan.ts` на ~50 строк:

- Читаем wire-format: varint-тег + length-delimited payload.
- На уровне top-level: каждый `entry` = tag `1` + varint длина + байты вложенного сообщения.
- Внутри вложенного сообщения находим первое поле `1` (string, wire type 2), читаем UTF-8 строку, остальные поля пропускаем через `skipField(tag, reader)`.
- Возвращаем `string[]` (имена в том же порядке, в котором они в файле — каноническая сортировка на UI-слое).

Почему не `protobufjs`: добавит ~200 KB в server-bundle; runtime сам по себе оверкилл для одного string-поля.

### Кэш

In-memory LRU-подобный кэш `apps/server/src/catalog/geo-cache.ts`:

```ts
interface CacheEntry {
  url: string
  fetched: Date
  entries: string[]
  etag?: string
}
```

- Ключ — `url`. TTL 24h. Максимум 8 записей (hedge против частой смены URL в профиле).
- Stale-on-error: если fetch падает, возвращаем последний успешный `CacheEntry` + флаг `error: string`.
- Force-refresh — `?refresh=1` на route.

### Эндпоинт

`GET /api/catalog/geo`:

```jsonc
{
  "geosite": {
    "entries": ["google", "youtube", "category-ru", ...],
    "source": "https://github.com/v2fly/domain-list-community/releases/latest/download/dlc.dat",
    "fetched": "2026-04-18T10:00:00.000Z",
    "error": null
  },
  "geoip": {
    "entries": ["ru", "cn", "us", "private", ...],
    "source": "https://github.com/MetaCubeX/meta-rules-dat/releases/latest/download/geoip.dat",
    "fetched": "2026-04-18T10:00:00.000Z",
    "error": null
  }
}
```

Ошибка сети для одной базы не валит другую: каждая ветка (`geosite`/`geoip`) имеет свой `error`.

### UI

Новый компонент `apps/web/src/components/services/GeoCatalogCombobox.vue`:

**Props:** `modelValue: string`, `type: 'GEOSITE' | 'GEOIP'`, `placeholder?: string`.
**Emits:** `update:modelValue`, `blur`.

**Поведение:**

- Тянет `useCatalogStore().loadCatalog()` on mount (no-op, если уже загружено).
- Инпут + выпадающий popover со списком.
- Fuzzy match (простой — `value.toLowerCase().includes(query.toLowerCase())`, топ-10).
- ↑/↓ — навигация по dropdown; Enter — выбор; Esc — закрыть dropdown.
- Свободный ввод разрешён: любое значение, которое пользователь оставляет в инпуте, сохраняется. Кастомные `.dat` могут содержать категории, которых нет в каталоге.
- Если `useCatalogStore().error[type] !== null` — показываем iconny-бейдж "offline"; dropdown не открывается; инпут работает как обычный текстовый.
- Button "↻" сбоку для force-refresh (вызывает `?refresh=1`).

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
  async function loadCatalog(force = false) {
    /* GET /api/catalog/geo[?refresh=1] */
  }
  return { geosite, geoip, loading, error, loadCatalog }
})
```

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

- `apps/server/tests/catalog/pb-scan.test.ts` — golden-dat фикстура (маленький вручную собранный `.dat` на 3 entries), проверка извлечённых имён.
- `apps/server/tests/catalog/geo-cache.test.ts` — TTL, stale-on-error, force-refresh.
- `apps/server/tests/routes/catalog.test.ts` — GET returns both sections, partial error scenarios.
- `apps/web/tests/catalog-combobox.spec.ts` — type-ahead, keyboard nav, fallback при error, свободный ввод.
- `apps/web/tests/rule-editor-geo.spec.ts` — при GEOSITE подставляется combobox, при IP-CIDR — Input.

---

## Секция 2 — Просмотр ожидающих изменений и полный сброс

### Поведение

`Header.vue` — бейдж `{ count } изменений` становится кликабельным (`<button>`-обёртка / `<Button variant="secondary" size="sm">`). При клике — открывается `PendingChangesDialog.vue`.

### Модалка `PendingChangesDialog.vue`

**Расположение:** `apps/web/src/components/layout/PendingChangesDialog.vue`.

**Props (от Header):** `open: boolean`, `v-model:open`.

**Содержимое:**

- Header: "Ожидающие изменения" + `Badge` со статистикой `+X / −Y` (извлекаем из сгенерированного patch'а через counting `+`/`-` строк, игнорируя `+++`/`---` заголовки).
- Body:
  - Если `config.rawLive === config.draftText` → "Изменений нет" (граничный случай; модалка откроется только если бейдж кликнули до того, как `dirtyCount` обновился).
  - Иначе — `diff2html` render unified patch'а. Генерация патча:
    ```ts
    import { createPatch } from 'diff'
    const patch = createPatch('config.yaml', rawLive, draftText, 'live', 'draft')
    ```
  - CSS — копируем минимальный subset из `SnapshotDiffDrawer.vue` (d2h-wrapper, .d2h-ins, .d2h-del и т.п.), чтобы не дублировать стили глобально.
- Footer:
  - `[Сбросить все изменения]` — `variant="destructive"`, `size="sm"`. Click → открыть вложенный `ConfirmDialog`:
    - Title: "Сбросить локальные правки?"
    - Body: "Все изменения будут удалены. Draft снова будет собран из актуального mihomo-конфига. Действие необратимо."
    - Confirm: "Сбросить" (destructive)
  - На confirm: `await config.clearDraft(); await config.loadAll(); emit('update:open', false)`.
  - `[Закрыть]` — `variant="outline"` — закрывает без изменений.

**Lazy-loading diff2html.** Идентично `SnapshotDiffDrawer.vue` — `await import('diff2html')` при первом открытии модалки, чтобы не раздувать initial bundle.

### i18n

Добавить в `apps/web/src/i18n/{en,ru}.json`:

```jsonc
"header": {
  "changes_badge_tooltip": "Показать изменения"
},
"pending_changes": {
  "title": "Ожидающие изменения",
  "stats": "+{added} / −{removed}",
  "no_changes": "Изменений нет",
  "reset_button": "Сбросить все изменения",
  "reset_confirm_title": "Сбросить локальные правки?",
  "reset_confirm_body": "Все изменения будут удалены. Draft снова будет собран из актуального mihomo-конфига. Действие необратимо.",
  "reset_confirm_action": "Сбросить",
  "close": "Закрыть"
}
```

### Тесты

- `apps/web/tests/pending-changes-dialog.spec.ts`:
  - Render с `rawLive !== draftText` → diff виден, статистика корректна.
  - Click на "Сбросить" → ConfirmDialog → confirm → `clearDraft` + `loadAll` вызваны.
  - `rawLive === draftText` → "Изменений нет".
- `apps/web/tests/header.spec.ts` — клик по бейджу открывает модалку.

---

## Секция 3 — Фикс vault-sentinel в `public-key` WG

### Фикс в `apps/server/src/vault/mask.ts`

Добавить allow-list, проверяющийся ПЕРЕД точным матчем и suffix-match:

```ts
export const SECRET_ALLOW_LIST = Object.freeze(['public-key'])

export function isSecretKey(key: string, fields: Set<string>): boolean {
  if (SECRET_ALLOW_LIST.includes(key)) return false
  if (fields.has(key)) return true
  for (const suf of SECRET_SUFFIXES) {
    if (key.endsWith(suf)) return true
  }
  return false
}
```

Также удалить `'public-key'` из `DEFAULT_SECRET_FIELDS` (чистота — оно не должно быть помечено как секрет в первом месте).

### Миграция существующих draft'ов (on-read)

Draft'ы, сохранённые ДО этого релиза, содержат `public-key: $MIHARBOR_VAULT:<uuid>`. Чтобы пользователь не встретил ту же ошибку после апгрейда, добавляем on-read миграцию в `apps/server/src/routes/config.ts` — GET `/draft`:

```ts
.get('/draft', async ({ request }) => {
  const user = getAuthUser(request) ?? 'anonymous'
  const draft = deps.draftStore.get(user)
  if (draft) {
    const { text: migrated, touched } = await migrateDraftPublicKeys(draft.text, deps.vault)
    if (touched) {
      const entry = deps.draftStore.put(user, migrated)
      return { source: 'draft' as const, text: migrated, updated: entry.updated }
    }
    return { source: 'draft' as const, text: draft.text, updated: draft.updated }
  }
  // ... fallback to masked live
})
```

**`migrateDraftPublicKeys` (`apps/server/src/vault/migrate-public-keys.ts`):**

- Парсит draft как yaml Document.
- `visit` по паттерну: если `Pair.key === 'public-key'` и value — scalar string startsWith `SENTINEL_PREFIX` → извлекает uuid через `value.slice(SENTINEL_PREFIX.length)`, резолвит через `vault.resolve(uuid)` (уже публичный метод интерфейса). Если resolve вернул `null` — оставляем sentinel как есть и пишем warn-log; иначе записываем реальный ключ обратно в scalar.
- Возвращает `{ text: doc.toString(), touched: boolean }`.

Код самоочищающийся: после одного cycle load→save старые sentinel'ы вымыты. Выполняется без spikes, потому что draft у пользователя обычно один.

### Мелочи

- `apps/server/src/deploy/pipeline.ts` — убедиться, что unmask-шаг теперь не трогает `public-key` (он и так не должен, т.к. `isSecretKey('public-key', ...)` возвращает `false` после фикса).
- `WIREGUARD_PRIVATE_KEY_SENTINEL` / `WIREGUARD_PRE_SHARED_KEY_SENTINEL` — не трогаем; это другой механизм (масктровка под read-only JSON view).

### Тесты

- `apps/server/tests/vault/mask.test.ts`:
  - Новый кейс: `public-key: abcd123=...` НЕ маскируется через `-key` suffix (проверка allow-list порядка).
  - Regression: `private-key`, `pre-shared-key`, custom `-secret` — всё ещё маскируются.
- `apps/server/tests/vault/migrate-public-keys.test.ts`:
  - Входной draft с `public-key: $MIHARBOR_VAULT:<uuid>` где vault знает uuid → на выходе реальный ключ, `touched: true`.
  - Draft без sentinel'ов → `touched: false`, текст не меняется.
  - Vault не знает uuid → keep as-is (не падаем), warn-log.
- `apps/server/tests/routes/config.test.ts`:
  - GET `/draft` с legacy sentinel'ами → возвращает разрезолвленный ключ; последующий GET возвращает то же (store обновился).

---

## План тестового покрытия

Baseline coverage (из последнего коммита): **89.98 %**. Новый код (парсер, кэш, combobox, dialog, миграция) покрывается unit- и e2e-тестами выше. Целевой baseline после мержа — не ниже **89 %** (не занижаем).

## Пофайловый перечень изменений

**Сервер:**

- `apps/server/src/catalog/pb-scan.ts` — новый
- `apps/server/src/catalog/geo-source.ts` — новый
- `apps/server/src/catalog/geo-cache.ts` — новый
- `apps/server/src/routes/catalog.ts` — новый
- `apps/server/src/server-bootstrap.ts` — подключить `catalogRoutes`
- `apps/server/src/vault/mask.ts` — allow-list + удалить public-key из defaults
- `apps/server/src/vault/migrate-public-keys.ts` — новый
- `apps/server/src/routes/config.ts` — on-read миграция в GET `/draft`

**Клиент:**

- `apps/web/src/api/client.ts` — эндпоинты каталога
- `apps/web/src/stores/catalog.ts` — новый
- `apps/web/src/components/services/GeoCatalogCombobox.vue` — новый
- `apps/web/src/components/services/RuleEditor.vue` — подключить combobox
- `apps/web/src/components/layout/PendingChangesDialog.vue` — новый
- `apps/web/src/components/layout/Header.vue` — кликабельный бейдж + подключить модалку
- `apps/web/src/i18n/en.json`, `apps/web/src/i18n/ru.json` — новые ключи

**Тесты:**

- `apps/server/tests/catalog/*.test.ts` — pb-scan, geo-cache, routes
- `apps/server/tests/vault/mask.test.ts` — дополнен
- `apps/server/tests/vault/migrate-public-keys.test.ts` — новый
- `apps/server/tests/routes/config.test.ts` — дополнен
- `apps/web/tests/catalog-combobox.spec.ts` — новый
- `apps/web/tests/rule-editor-geo.spec.ts` — новый
- `apps/web/tests/pending-changes-dialog.spec.ts` — новый
- `apps/web/tests/header.spec.ts` — дополнен / новый

## Порядок реализации

1. **Секция 3 (WG public-key)** — независимо, быстро. Разблокирует пользователя.
2. **Секция 2 (просмотр изменений + reset)** — быстро, reuses `diff2html` из History.
3. **Секция 1 (geo-каталог)** — объёмнее (парсер + endpoint + combobox).

Каждая секция — отдельный commit / PR, чтобы коллайдеры были минимальны.
