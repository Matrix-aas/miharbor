# Miharbor — визуальный редактор конфига mihomo

**Тип документа:** дизайн-спецификация
**Дата:** 2026-04-16
**Версия:** 2 (после code-review и PoC)
**Статус:** утверждено пользователем, готово к написанию плана

---

## 1. Цель и суть проекта

Miharbor — web-инструмент с графическим интерфейсом для редактирования конфигурационного файла mihomo (`config.yaml`). Покрывает все аспекты конфига: прокси-ноды, прокси-группы, правила маршрутизации, DNS, TUN, sniffer, rule-providers, raw-YAML редактор для экспертных правок. Плюс deploy-пайплайн с диффом, валидацией и автооткатом; плюс «умная помощь» в редакторе, которая ловит класс ошибок ещё до попытки применения.

**Почему это нужно:** существующий Zashboard отлично читает состояние mihomo и переключает уже созданные группы DIRECT/VPN, но не умеет создавать/удалять группы, редактировать правила, управлять нодами и вообще модифицировать файл. Mihomo REST API читает правила, но не пишет их. Значит, любой визуальный редактор обязан иметь свой backend, который правит yaml-файл на диске и инициирует reload.

**Не клон Zashboard:** собственный UX, ориентированный на редактирование (master-detail, stepper-deploy, inline-ассистент), а не на мониторинг.

**Open-source публикация:** проект оформляется как независимый GitHub-проект под именем **Miharbor** (от mihomo + harbor/гавань). Две цели: (а) собственное удобство, (б) инструмент для сообщества. Отсюда публичный репозиторий, Docker-первый деплой, двуязычная документация.

---

## 2. Режимы работы

Поддерживается два способа установки и работы. UI и функционал идентичны в обоих.

**Режим «Docker на сервере»** (основной для публики). Пользователь поднимает контейнер рядом с mihomo, монтирует директорию с конфигом как volume, указывает REST API mihomo через ENV. Типовая установка: `docker compose up -d` + опциональный reverse-proxy.

**Режим «Локально на Mac» (или любой другой рабочей машине).** Клонируешь репу, `bun install && bun run dev`, в `.env` указываешь SSH-креды до своего роутера. Backend ходит на сервер по SSH (ключом), читает и пишет конфиг через SCP, валидирует удалённым `mihomo -t`, reload через mihomo API (прямой или через SSH-туннель). Удобно для тех, кто не хочет ставить лишний контейнер на роутер, либо разрабатывает сам Miharbor.

Переключение режимов — через ENV-переменную `MIHARBOR_TRANSPORT` (`local` | `ssh`). Весь остальной код не знает о различии.

---

## 3. Технический стек

**Frontend:**
- Vue 3 (Composition API, `<script setup>`)
- TypeScript strict
- Vite (dev-сервер, HMR, продакшн-сборка)
- Pinia (state management)
- Tailwind CSS + shadcn-vue (для готовых компонентов — dialog, combobox, drawer, code editor)
- Monaco Editor (Raw YAML режим, syntax highlight, diff)
- `vue-i18n` (EN/RU, автодетект по `Accept-Language`)

**Backend:**
- Bun (runtime + package manager)
- Elysia (HTTP-фреймворк, первоклассная интеграция с Bun, строгая типизация через TypeBox)
- `yaml` (Eemeli Aro) — ключевая библиотека, работа с Document API, **сохраняет комментарии и форматирование** при редактировании
- `ssh2` (для SSH-транспорта)
- `diff` (unified diff генерация)
- `Bun.password` (Argon2id — встроенный в Bun, быстрее bcrypt)
- `node-cron` (ретеншен снапшотов, отказ от `setInterval`)
- `proper-lockfile` (cross-platform `flock`-эквивалент для LocalFs; `flock` exec для SshTransport)

**Монорепо:**
- Bun workspaces
- `apps/web` (Vue), `apps/server` (Elysia), `packages/shared` (общие типы + валидаторы)

**Деплой:**
- Один Docker image (multi-stage build): этап 1 — build Vue в статику; этап 2 — Bun + Elysia + статика. Итог — slim-образ, раздаёт и API, и статику с одного порта.
- `docker-compose.yml` пример в репе, с переменными окружения и volume-mount'ами.
- Multi-arch сборка (linux/amd64 + linux/arm64) для Raspberry Pi и Apple Silicon.
- **Валидация конфига не делается вшитым бинарём mihomo** (решение H1 ревью): вшитый бинарь создавал бы версионные расхождения с mihomo на сервере (1.19.23 vs 1.19.10 → пропустит кривой конфиг или наоборот). Вместо этого валидация делегируется тому же mihomo, что работает у пользователя — через REST API (`PUT /configs?force=true` без `path`, либо в проверочный test-mode endpoint, если появится). В SSH-режиме — `ssh exec 'mihomo -t -d /tmp/miharbor-test/'` на сервере. В Docker-режиме — через опциональный `docker exec <mihomo-container> mihomo -t` (требует монтирования docker socket) или тот же путь. Если ни один путь недоступен — валидация ограничивается локальным линтером + `yaml`-parse, и UI явно предупреждает «нет preflight на реальном mihomo».

**CI/CD (в рамках проекта):**
- GitHub Actions: lint + typecheck + test + build image + push в GHCR.
- Releases с семантическим версионированием.

---

## 4. UI-структура

**Каркас** — гибрид с группированным сайдбаром и фиксированным статусным хедером (вариант C из брейнсторма):

- **Хедер:** лого «Miharbor», индикатор «текущий режим: Docker / SSH», версия конфига (`v14`), бейдж несохранённых изменений («3 изменения»), кнопка «Применить» с иконкой и счётчиком. Справа — переключатель EN/RU, кнопка настроек.
- **Сайдбар (с подзаголовками):**
  - **Routing:** Сервисы · Прокси-ноды · Rule-providers
  - **Инфра:** DNS · TUN · Sniffer · Профиль
  - **Advanced:** Raw YAML · История · Настройки
- **Основная область:** зависит от выбранного раздела.

**Определение «Сервис» (H2 ревью).** В Miharbor «сервис» — виртуальная конструкция `{ group: proxy-group, rules: Rule[] }`, где все правила ссылаются на эту группу. Это НЕ часть mihomo-формата, это UX-абстракция. Обратное mapping — 1:1 через `rules[].target == group.name`. Edge cases:
- Группа без правил → «неиспользуемый сервис» (warning в UI).
- Health-check hidden-группы (`type: url-test`) → отдельный раздел «Служебные группы», не в «Сервисы».
- Fallback-группы (`Остальной трафик` с `MATCH` правилом) → отображаются, но UI предупреждает «это ловушка для всего остального, не удаляй без понимания».

**Экран «Сервисы»** (главный, master-detail — вариант A из брейнсторма):
- Слева — список сервисов с поиском, фильтром (VPN/DIRECT/REJECT), счётчиком правил, бейджем «конфликт» при проблемах линтера.
- Справа — панель деталей: переключатель DIRECT/VPN/REJECT (с учётом возможных proxies в группе), список правил с inline-редактированием (DOMAIN-SUFFIX / GEOSITE / IP-CIDR / GEOIP / IP-ASN), кнопка «+ Добавить правило», кнопка «Удалить сервис» (с подтверждением + «удалить N связанных правил»).
- **AND/OR/NOT-правила (H3 ревью).** В MVP (этап 1) сложные составные правила (`AND,((…),(…))`, `OR,((…))`) отображаются как **read-only** строки с badge «сложное правило» и tooltip «редактируй в Raw YAML». В этапе 2 — tree-editor с вложенными условиями. Это не блокирует использование UI для 95% пользователей (составные правила используются редко — в config-server.yaml их 5 штук из 100 правил).
- Вверху справа — кнопка «+ Сервис» (открывает визард создания со smart-подсказками).

**Экран «Прокси-ноды»:**
- Список нод (WireGuard, Shadowsocks, VMess, Trojan, HTTP, SOCKS) с типом и статусом (реальная задержка через mihomo `/proxies/:name/delay`).
- Форма добавления — разная под каждый тип, TypeBox-валидация в реальном времени.
- Импорт одной кнопкой: вставил `vless://…` / `ss://…` / полный WireGuard-конфиг → распарсили и заполнили форму.

**Экран «Rule-providers»:**
- Список подключённых провайдеров (`hagezi_pro`, `discord` inline из твоего конфига).
- Типы: `http` (URL), `file` (путь), `inline` (редактор правил).
- Behavior (domain / classical / ipcidr), формат (mrs / yaml / text), TTL.
- Кнопка «обновить сейчас» дёргает mihomo API.

**Экран «DNS»:**
- Все поля `dns:` структурно: `listen`, `enhanced-mode`, fake-ip-range, nameserver/direct-nameserver/fallback/proxy-server-nameserver/default-nameserver как управляемые списки, fake-ip-filter, nameserver-policy (editable map).
- Над критичными полями (`listen`, `proxy-server-nameserver`) — плашки-guardrails со ссылкой на объяснение инварианта.

**Экран «TUN»:**
- Тумблер `enable`, dropdown `stack` (system/gvisor/mixed), `device`, `mtu`, тумблеры auto-route / auto-redirect / auto-detect-interface / strict-route.
- Список `route-exclude-address` с подсветкой «это self-intercept guard — не удаляй» на `91.132.58.113/32` если такой IP есть в nodes.

**Экран «Sniffer»:**
- Тумблер enable, редактор sniff-секций (HTTP/TLS/QUIC порты).

**Экран «Профиль» (верхний уровень):**
- `mode` (rule/global/direct), `log-level`, `ipv6`, `tcp-concurrent`, `unified-delay`, `external-controller`, `secret:` (masked с кнопкой-глазом), `interface-name`, `routing-mark`, `geo-update-interval`, `keep-alive-*`, etc.

**Экран «Raw YAML»** (в MVP — read-only, в этапе 2 — full edit; H3 ревью перенёс read-only в этап 1):
- Monaco Editor во всю ширину, мини-карта справа, clash-schema подсказки, syntax highlight.
- В MVP — **read-only**, показывает текущий черновик как единое целое (полезно для AND/OR-правил и экспертного обзора).
- В этапе 2 — переключатель «view / edit», в edit можно править напрямую.
- **Fallback UI при невалидном YAML (P12 ревью).** Если в edit-режиме пользователь создал YAML, который не парсится `yaml.Document`, — UI показывает ошибку parser'а с line/column, все остальные разделы grey-out с сообщением «исправь raw YAML чтобы редактировать структурно». Это предотвращает состояние «UI думает одно, файл содержит другое».
- Кнопка «Применить прямо отсюда» тоже запускает deploy-стейппер.

**Экран «История»:**
- Таймлайн снапшотов (дата, автор-ENV, размер diff'а).
- Каждая запись раскрывается в diff против текущей версии.
- Кнопка «Откатить на эту версию» — делает новый снапшот текущей + применяет старую через тот же deploy-пайплайн.

**Экран «Настройки»:**
- Транспорт (только для справки, меняется через ENV).
- Путь к конфигу, mihomo API URL, секрет API.
- Basic Auth (user, смена пароля).
- SSH-креды (в SSH-режиме).
- Ключи LLM — Anthropic и OpenAI (ввод, статус «задан / не задан»).
- Параметры автооткатa (таймаут healthcheck, retention снапшотов).

---

## 5. Модель данных

**Источник истины — YAML Document (AST) в памяти backend'а.** Не парсим в «свою» типизированную модель и обратно — так теряются комментарии. Вместо этого используем `yaml.Document` от eemeli/yaml: при загрузке парсим в CST+AST с комментариями, при любой операции модифицируем узлы через Document API (`doc.getIn(['rules'])`, `doc.setIn(…)`, `doc.addIn(…)`).

**Одноразовая canonicalization при первом импорте конфига** (PoC подтвердил необходимость). Сериализатор `yaml@2.x` не сохраняет колоночное выравнивание во flow-mappings (например, `{name: 'Gemini',     type: select, ...}` превращается в `{name: 'Gemini', type: select, ...}`) и множественные пробелы перед inline-комментариями. Чтобы первые же мутации не порождали визуально шумные diff'ы, при первом применении Miharbor на существующий конфиг выполняется **format-only миграция**: конфиг парсится и пересохраняется в canonical-формате, создаётся отдельный snapshot `applied_by: 'canonicalization'`, UI явно предупреждает «это разовое приведение к каноническому виду, комментарии и логика сохраняются 1-в-1, теряется только выравнивание колонок внутри flow-mappings». Дальнейшие deploy-ы дают точечный diff (`+1/-1` на одну мутацию). Сериализатор вызывается с опциями: `lineWidth: 0, minContentWidth: 0, flowCollectionPadding: false, defaultStringType: 'PLAIN', doubleQuotedMinMultiLineLength: 999999`. Идемпотентность формата проверена.

**View-слой для frontend'а.** Backend предоставляет REST-эндпоинты, возвращающие JSON-проекции конкретных секций (`GET /config/services`, `GET /config/dns`, etc.). Frontend редактирует проекцию, отправляет обратно, backend применяет изменения к Document'у точечно.

**Draft vs. applied.** Во время редактирования все изменения идут в «черновой Document» в памяти. Счётчик несохранённых изменений — `draft.dirty`. Кнопка «Применить» запускает deploy-пайплайн против черновика. Откат (Cancel) — перечитать с диска.

**Concurrent-safety (B2 ревью).** Комбинация файловой блокировки + хэш-проверки.

1. **Advisory lock на всё время deploy-пайплайна:** `proper-lockfile` (в LocalFs-режиме) / `flock -xn <lockfile>` (в SSH-режиме). Lock-файл — `/etc/mihomo/.miharbor.lock` (на том же mount что конфиг, чтобы rename был атомарным). Если лок не получен в 5 секунд — UI показывает «другой процесс редактирует конфиг (pid=N, host=M)» и предлагает принудительно снять лок (с кнопкой «я понимаю»).
2. **Хэш при загрузке + re-check под локом:** при load сохраняем sha256 файла. Перед финальной записью (уже под локом) перечитываем файл и сравниваем хэш. Если разошёлся — UI предлагает одно из трёх: (a) перезагрузить конфиг и применить изменения поверх, (b) 3-way merge (для простых случаев — только в rules/proxy-groups), (c) сохранить поверх с явным подтверждением.
3. **Два пользователя Miharbor одновременно.** Оба ловят один и тот же lock. Второй получает явное сообщение «UserA @192.168.1.42 сейчас применяет изменения, жди или прерви» (метаданные в lock-файле).

**Типы сервиса (domain model).** Хотя источник истины YAML, мы определяем TypeScript-типы в `packages/shared` для сообщения между backend и frontend: `Service`, `Rule`, `ProxyNode`, `RuleProvider`, `DnsConfig`, `TunConfig`, и т.д. Эти типы описывают view-проекцию, не сам YAML.

---

## 6. Транспортный слой

Интерфейс `Transport` в `apps/server/src/transport/transport.ts`:

```ts
interface Transport {
  readConfig(): Promise<{ content: string, hash: string }>
  writeConfig(content: string): Promise<void>
  readSnapshotsDir(): Promise<SnapshotMeta[]>
  writeSnapshot(snapshot: Snapshot): Promise<void>
  runMihomoValidate(tmpContent: string): Promise<ValidationResult>
  mihomoApiUrl(): string  // для reload
  mihomoApiSecret(): string
}
```

**LocalFsTransport** (Docker или standalone на сервере):
- `readConfig/writeConfig` — `fs.readFile/writeFile` против `MIHARBOR_CONFIG_PATH`.
- `runMihomoValidate` — пишет во временный файл в `/tmp`, запускает `./mihomo -t -d /tmp/` (бинарь внутри образа), парсит вывод.
- Снапшоты — `MIHARBOR_DATA_DIR/snapshots/`.

**SshTransport** (локальный запуск на Mac / любой рабочей машине):
- `ssh2` клиент переиспользуется между вызовами (keep-alive 30 сек), с автоматическим reconnect при drop. Retry-логика: до 3 попыток с exponential backoff, после — UI показывает «ssh недоступен» и deploy-pipeline останавливается на шаге где обрыв (снапшот уже сделан если дошли до него, потерь данных нет).
- **Аутентификация (B3 ревью).** Три поддерживаемых способа, в порядке предпочтения:
  1. **`ssh-agent`** (рекомендованный). Если `SSH_AUTH_SOCK` задан в env — используем agent-forwarding, passphrase не требуется, ключи из agent'a. Это безопасный способ работы с защищёнными ключами.
  2. **Ключ без passphrase**, путь в `MIHARBOR_SSH_KEY_PATH`. По умолчанию пробуем `~/.ssh/id_ed25519`, `~/.ssh/id_rsa`. Если ключ защищён passphrase — запуск падает с сообщением «защищённый ключ; запусти через ssh-agent или задай passphrase в `MIHARBOR_SSH_KEY_PASSPHRASE`» (последнее не рекомендуется, но опционально поддерживается для автоматизаций).
  3. **`MIHARBOR_SSH_KEY_PASSPHRASE`** в env (fallback).
- **Sudo для записи в /etc/mihomo.** Mihomo-конфиг обычно owned root. Три варианта, описанные в README:
  1. **`NOPASSWD` sudoers** для deploy-юзера (рекомендация): добавляется строка `miharbor ALL=(root) NOPASSWD: /bin/mv /tmp/miharbor-*.yaml /etc/mihomo/config.yaml, /bin/systemctl restart mihomo, /usr/local/sbin/mihomo-validate` (последнее — wrapper скрипт, который Miharbor генерирует в README).
  2. **Отдельный user `miharbor`** с `chown miharbor:miharbor /etc/mihomo/` — никакого sudo не нужно. Для тех кто хочет минимальные привилегии.
  3. **Root-SSH** (только для dev) — прямой `root@host` доступ.
- **Атомарная запись (H6 ревью).** Upload делается в `/etc/mihomo/.miharbor.draft.yaml` (на том же mount что и target). Далее `mv` (через sudo если 1) — атомарный rename на одном mount. `/tmp` как промежуточный буфер НЕ используется (на Ubuntu это tmpfs — другой mount → `mv` превращается в copy+unlink, не атомарно).
- `readConfig` — SCP в локальный temp.
- `writeConfig` — см. «атомарная запись» выше.
- `runMihomoValidate` — заливает tmp-файл в `/etc/mihomo/.miharbor.test.yaml`, `ssh exec 'sudo -n mihomo-validate /etc/mihomo/.miharbor.test.yaml'` (wrapper-скрипт в репе документирует безопасные флаги).

Транспорт выбирается в `apps/server/src/bootstrap.ts` по ENV. Тесты используют `InMemoryTransport` (mock).

---

## 7. Deploy-пайплайн

Кнопка «Применить» запускает 6-этапный stepper (вариант A из брейнсторма). UI отображает каждый этап с состоянием (○ ожидает, ◐ выполняется, ● завершён, ✕ ошибка).

1. **Diff-рендер.** Unified diff между текущим файлом на диске и черновиком. Визуализация через `diff2html`.
2. **Клиентская валидация.** Запуск всех 9 smart-checks (см. §8) на черновике. Если есть ошибки уровня «blocker» — кнопка «Применить» в степпере блокируется, пользователь возвращается в UI и чинит. Warnings отображаются, но пропускаются с галочкой.
3. **Снапшот.** Текущее содержимое (не черновик) сохраняется в `snapshots/<timestamp>-<hash>.yaml` + metadata.json с автором/числом изменений.
4. **Preflight на сервере.** `runMihomoValidate(draft)` — mihomo парсит черновик на сервере и подтверждает, что его собственная валидация прошла. Ошибки с привязкой к строкам.
5. **Запись + reload.** `writeConfig(draft)` — атомарная запись (tmp + rename на том же mount). Дальше `PUT ${mihomoApiUrl}/configs?force=true` с `Authorization: Bearer ${secret}`. Если API недоступно — **крайний fallback: `sudo systemctl restart mihomo`** (через SSH exec или через локальный shell в Docker-режиме при доступе к docker socket). Честно признаём, что этот путь влечёт ~5 сек downtime для LAN-трафика — UI показывает предупреждение «API недоступен, будет restart unit».
6. **Healthcheck (B4 ревью — переработано).** Polling-модель вместо фиксированного таймаута, с учётом особенностей mihomo reload:
   - **Фаза 1: API alive (до 10 сек).** Poll `GET /version` каждые 500ms. Цель — убедиться что mihomo вообще запустился.
   - **Фаза 2: Rules+providers loaded (до 60 сек).** `GET /providers/rules` — проверяем что `updatedAt` у каждого rule-provider обновился; для крупных провайдеров (hagezi_pro — до 500k записей) первичная загрузка занимает 15–30 сек. Если за 60 сек не загрузились — warning, не ошибка (деградация, не авария).
   - **Фаза 3: Proxy delay-check (до 30 сек).** Для health-check групп запускаем `GET /proxies/<name>/delay?url=http://www.gstatic.com/generate_204&timeout=5000`. Убеждаемся что хотя бы один прокси в каждой активной группе отвечает.
   - **Фаза 4 (опциональная, включается через `MIHARBOR_E2E_HEALTHCHECK=true`):** пингануть известный домен через mihomo (например `curl --proxy http://<mihomo>:<port>/ https://example.com` — только если port-режим включён; в TUN-only режиме — выключено по умолчанию).

   **Авто-rollback.** Если фаза 1 упала — немедленный авто-rollback. Если фаза 3 упала — авто-rollback с подтверждением UI (можно отключить авто-rollback для фазы 3 через ENV). Rollback = новый snapshot текущего состояния (`applied_by: 'auto-rollback'`) + применение предыдущего snapshot'а через тот же пайплайн (начиная с шага 5). **Честное предупреждение в UI: «между fail и rollback LAN-трафик прерывается на N секунд; для транспарентного роутера это ощутимо».** Пользователь может отключить авто-rollback через `MIHARBOR_AUTO_ROLLBACK=false` если предпочитает «упало — разберусь вручную».

   **Dedupe rollback'ов (H5 ревью).** Если авто-rollback запускается, снапшот `applied_by: 'auto-rollback'` **не создаёт новую запись истории, если** содержимое совпадает с непосредственно предыдущим снапшотом — это защищает от цикла «rollback → применить v14 → rollback» забивающего retention.

   **Continuous healthcheck после deploy (P13 ревью).** После успешного deploy в хедере UI бейдж «mihomo online / offline» обновляется раз в 60 сек. Если mihomo упал через час — пользователь увидит. Авто-rollback после deploy-пайплайна не делается.

**Общие правила:**
- Ошибка на любом шаге 1-4 останавливает пайплайн и пропускает шаги 5-6 (не применяется ничего).
- Шаг 3 (снапшот) выполняется ПЕРЕД шагом 5, даже если пользователь отменил на шаге 4 (preflight) — это даёт нам точку «что было до попытки», если что-то пойдёт не так после.
- При fail'e шага 5 (запись не прошла, например, на SCP) — снапшот уже есть, rollback применим вручную из Истории.

---

## 8. Smart-assistance

**Разделение shared vs server (B6 ревью).** Не все 9 алгоритмов могут работать в браузере. Разделение:

| # | Название | Где живёт | Почему |
|---|---|---|---|
| 1 | Unreachable rules | `packages/shared/linter/` | чистая логика на AST + опциональная проверка GEOSITE через сервер |
| 2 | Invariants guardrails | `packages/shared/linter/` | чистые предикаты |
| 3 | Duplicates & dangling refs | `packages/shared/linter/` | чистая логика на AST |
| 4 | Service templates | shared (fuzzy-match) + `apps/server/src/linter-server/` (GEOSITE lookup) | шаблоны локально, категории GEOSITE требуют `.dat` |
| 5 | Auto-placement | `packages/shared/linter/` | чистая логика на порядке правил |
| 6 | DNS+GEOIP lookup | `apps/server/src/linter-server/` | браузер не умеет `dig`, DoH упирается в CORS, `geoip.dat` = 8МБ+ |
| 7 | Impact preview | `packages/shared/linter/` (текстовая база) + `packages/shared/i18n/` (локализация) | чистая логика + hardcoded эвристики |
| 8 | Preflight `mihomo -t` | `apps/server/src/linter-server/` + transport | зависит от Transport |
| 9 | LLM ассистент | `apps/server/src/llm/` | ключи, API-запросы, контекст-фильтр |

Клиентская подсветка (shared) — мгновенная, без round-trip. Серверный линтинг — по `/api/lint` для тяжёлых проверок (wrapper-endpoint вызывает серверный + импортирует shared и запускает).

Каждое правило возвращает `Issue { level: 'error'|'warning'|'info', code, message, path, autofix? }`.

**1. Unreachable rules detector.** Строит дерево перекрытий: правила сверху→вниз, каждое новое правило сравнивается с предыдущими. Если правило-предок покрывает правило-потомок (DOMAIN-SUFFIX покрывается большим DOMAIN-SUFFIX, GEOSITE с тем же keyword, и т.д.) — помечает потомка как unreachable. Для GEOSITE — загружаем локальный index (см. п.4) и проверяем не входит ли конкретный домен в категорию.

**2. Invariants guardrails.** Две группы инвариантов:

**2a. Universal invariants** (всегда активны, родовые правила mihomo): `dns.listen` не равен `0.0.0.0:53` (collision с системным resolver), `secret:` если задан — длиной ≥16 символов, `interface-name` явно задан (не auto-detect), TUN `dns-hijack: []` по умолчанию. Хранятся в `packages/shared/linter/invariants-universal.ts`.

**2b. User-defined invariants** (необязательные, включаются в настройках). Пользователь описывает свои правила в `MIHARBOR_DATA_DIR/invariants.yaml`. Примеры для нашего роутера — на `dns.listen === '127.0.0.1:1053'`, `external-controller` не равен `0.0.0.0:*`. Это решение H4 ревью — публичный проект не должен hardcode-ить правила конкретной инсталляции.

**Динамическая проверка `route-exclude-address` (H4 + P14 ревью).** Линтер пробегает `proxies[].server` и для каждого IP/hostname проверяет что он в `tun.route-exclude-address`. Для hostname — через DNS-lookup на сервере (линтер #6). Если не в exclude — **warning** «нода X сервером Y не в route-exclude, возможен self-intercept loop». Не блокер для deploy, но подсвечивается.

При нарушении универсального инварианта — красная плашка с текстом `[последствие]`. Плашки — локализованы (i18n ключи, см. H10 решение ниже).

**3. Duplicates & dangling references.** Детектит: (а) одно правило в разные группы, (б) `RULE-SET,X,Y` где нет rule-provider X, (в) правила ссылающиеся на несуществующую proxy-group, (г) proxy-group ссылающаяся на несуществующую ноду, (д) дублирующиеся DOMAIN-SUFFIX внутри одной группы. При удалении группы показывает список зависимых правил с опцией «удалить вместе».

**4. Service templates suggester.** Локальная база ~200 популярных сервисов в `packages/shared/templates/services.json`. Структура: `{ name, aliases, geosite?, domains: string[], typical_direction: 'proxy'|'direct', description_i18n: {en, ru, …} }`. При создании сервиса — fuzzy-match имени, предложение готового шаблона. Плюс подсказка GEOSITE-категорий — через линтер #8.

**5. Auto-placement.** Набор правил о иерархии блоков: `[0] ad-blocking`, `[1] private/local`, `[2] RU direct`, `[3] service-specific`, `[4] CDN`, `[5] MATCH default`. При добавлении правила проверяем его тип и предлагаем блок с объяснением «если положить позже, правило будет перекрыто правилом №N».

**6. Live DNS+GEOIP lookup.** Серверный линтер. Backend при редактировании домена делает DoH-запрос к `1.1.1.1` (или через `MIHARBOR_DOH_RESOLVER` ENV), результат резолвится по `geoip.dat` из того же пути что и mihomo (H8 ревью): в LocalFs-режиме — `${MIHOMO_CONFIG_DIR}/geoip.dat`, в SSH-режиме — SCP-pull при старте и периодическое обновление. Это гарантирует **консистентность с runtime mihomo** — если mihomo использует старый `geoip.dat`, Miharbor использует тот же. Если `.dat` не найден — линтер возвращает только IPs без GEOIP-метки. Возвращает `{ ips: string[], geoip: string|null, covered_by_existing_rule?: { index, rule } }`. Результат кэшируется на час в памяти backend'а.

**7. Impact preview.** Эвристики на известные переключения, хранятся в `packages/shared/linter/impact-templates.json` с i18n-локализацией (решение L6 ревью — убрать hardcoded RU-политику из кода). Формат: `{ trigger: { group_name_regex, direction_change: 'to-proxy'|'to-direct' }, impact_i18n: {en: "…", ru: "…"}, severity: 'info'|'warning' }`. Примеры:
- `group_name_regex: 'RU трафик', direction_change: 'to-proxy'` → warning «may break access to regional services». Локализованный текст — PR-friendly (не hardcode в коде).
- `group_name_regex: 'Cloudflare', direction_change: 'to-direct'` → info «expose real IP to many sites behind Cloudflare».

Комьюнити может дополнять через PR в `impact-templates.json`. Фича опциональная (этап 3).

**8. Preflight `mihomo -t` в песочнице.** Часть deploy-пайплайна (шаг 4). Реализуется через `runMihomoValidate` транспорта — использует **тот же** mihomo, что на сервере (через SSH exec или docker exec), не вшитый бинарь (см. секцию 3 «Деплой», H1 ревью).

**9. LLM-ассистент (опционально, см. секцию 10.4 про защиту).**
- Боковая панель (drawer справа, ctrl+k чтобы открыть).
- Провайдер: Anthropic Claude (default) или OpenAI GPT, выбирается в настройках по наличию ключа.
- **Контекст:** allow-list (см. 10.4), не deny-list.
- **Explicit consent** перед каждым запросом (см. 10.4).
- Формат ответа: LLM инструктирован возвращать либо текст, либо diff-патч в формате `*** SEARCH/REPLACE ***` блоков с явным путём в YAML. Backend применяет патч, UI показывает как обычный diff, пользователь принимает/отклоняет.
- Модели: Anthropic `claude-opus-4-7`, OpenAI `gpt-5.1` (настраивается через ENV).

---

## 9. Снапшоты и rollback

**Формат снапшота:** директория `snapshots/<ISO8601>-<sha256-prefix>/` с файлами:
- `config.yaml` — YAML с **замаскированными секретами** (см. ниже про vault).
- `meta.json` — `{ timestamp, sha256_original, sha256_masked, applied_by: 'user'|'rollback'|'auto-rollback'|'canonicalization', user_ip, user_agent, diff_summary: {added, removed}, mihomo_api_version, transport }`.
- `diff.patch` — unified diff **маскированной** версии против предыдущего снапшота (для UI-таймлайна). Реальные секреты в diff'ы не попадают никогда.

**Sentinel-vault для секретов (B1 ревью).** Секретные поля в снапшотах заменяются на sentinel-идентификаторы, реальные значения хранятся отдельно и шифруются:

- **Секретные поля (захардкожены, дополняются из ENV `MIHARBOR_SECRET_FIELDS`):** `secret` (mihomo Bearer), `private-key` (WireGuard), `pre-shared-key`, `password` (SS/Trojan/user-pass), `public-key` (вздохом — не секрет, но пара к private-key; храним вместе для rollback-консистентности), `uuid` (VMess), любой ключ с суффиксом `-key`, `-password`, `-token`, `-secret`.
- **Sentinel формат:** `$MIHARBOR_VAULT:<uuid-v4>`. Пример: `secret: "$MIHARBOR_VAULT:3f2b...ef91"`.
- **Vault-файл:** `MIHARBOR_DATA_DIR/secrets-vault.enc`. Структура: JSON map `{ uuid → { value: string, created: ISO8601, referenced_by: string[] } }`, **зашифрован AES-256-GCM** с ключом из `MIHARBOR_VAULT_KEY` ENV (32 байта hex). Если `MIHARBOR_VAULT_KEY` не задан — генерируется при первом запуске и сохраняется в `MIHARBOR_DATA_DIR/.vault-key` (mode 600) с warning в логах «сгенерирован новый ключ, backup обязателен, потеря ключа = потеря всех истории снапшотов».
- **Права на vault-файлы:** `MIHARBOR_DATA_DIR/` = `0700`, `.vault-key` и `secrets-vault.enc` = `0600`, `snapshots/*/config.yaml` = `0600`.
- **Rollback:** при восстановлении snapshot — sentinel'ы разрешаются обратно в реальные значения из vault и записываются в target `/etc/mihomo/config.yaml`. Если sentinel не найден в vault (повреждение vault, ручное редактирование) — UI отдельно спрашивает «введи значение для secret/private-key/etc. для ноды N».
- **GC vault'а:** каждый sentinel отслеживает `referenced_by` (ID снапшотов). Когда snapshot удаляется по retention — уменьшаем refcount, при нуле — удаляем запись из vault.
- **UI-рендер diff:** в истории снапшотов показываются diff'ы маскированных версий. Реальные значения никогда не отдаются в HTTP-ответе UI без явной команды «показать секреты» (с пароль-подтверждением или дополнительным Basic Auth).

**Retention (H7 ревью — формула уточнена):** «keep N = max(count, days)» — снапшоты удаляются только если **оба** условия одновременно выполнены («старше 30 дней» **И** «не входит в последние 50»). Настраивается через `MIHARBOR_SNAPSHOT_RETENTION_COUNT` (default 50) и `MIHARBOR_SNAPSHOT_RETENTION_DAYS` (default 30). Проверка retention — через `node-cron` раз в сутки (не `setInterval`, более надёжно при рестарте контейнера).

**Rollback:** клик на снапшоте в Истории → «Откатить». Под капотом — создаём новый снапшот текущего (`applied_by: 'rollback'`), потом запускаем стандартный deploy-пайплайн с содержимым выбранного снапшота (после разрешения sentinel'ов через vault) как черновиком. То есть откат — это просто deploy другого содержимого, с той же валидацией и healthcheck.

**Поиск/фильтр в истории (M9 ревью).** Экран Истории поддерживает: full-text search по маскированному содержимому, фильтр по `applied_by` (user/rollback/auto-rollback/canonicalization), фильтр по диапазону дат, sort по размеру diff.

---

## 10. Аутентификация и безопасность

### 10.1. Basic Auth и доступ

**Встроенный Basic Auth.** ENV `MIHARBOR_AUTH_USER` + `MIHARBOR_AUTH_PASS_HASH` (Argon2id через `Bun.password`). Alternative в режиме разработки: `MIHARBOR_AUTH_DISABLED=true` (для локального запуска на Mac, где приложение на `localhost:5173`). Все запросы к `/api/*` и `/vault/*` проходят через middleware; статические assets отдаются без auth (sanity: только index.html с ссылкой на /login).

**Первый запуск (L5 ревью).** Если `MIHARBOR_AUTH_PASS_HASH` не задан и `MIHARBOR_AUTH_DISABLED != true` — backend стартует с временным паролем `admin/admin`, **требует** его сменить при первом входе в UI (redirect на /settings), выводит красный баннер «пароль временный, смени сейчас». После смены — хэш сохраняется в `MIHARBOR_DATA_DIR/auth.json` (mode 600), приоритет: `auth.json` > `MIHARBOR_AUTH_PASS_HASH` ENV.

**Reverse-proxy trust (H9 ревью — закрыта уязвимость spoof'а).** ENV:
- `MIHARBOR_TRUST_PROXY_HEADER=X-Forwarded-User` — какой header доверять.
- `MIHARBOR_TRUSTED_PROXY_CIDRS=127.0.0.1/32,172.16.0.0/12` — **только от этих IP** header учитывается. Запросы с других IP с этим header'ом — игнорируют trust и проходят обычный Basic Auth.
- Default: trust выключен. В README явно предупреждаем «при exposing контейнера на 0.0.0.0 без этой настройки — любой может послать `X-Forwarded-User: admin` и обойти auth».

**Brute-force (P8 ревью).** Внутренний rate-limit через Elysia `rate-limiter` plugin: `/api/auth/login` → 5 попыток за 5 минут с одного IP, потом 15 мин lockout. Плюс явная рекомендация в README — ставить перед Miharbor CrowdSec/fail2ban/Authelia для production. Внутренний rate-limit — минимум, не замена проксе.

**Документация небезопасных дефолтов.** README раздел «Production checklist» явно требует: (1) сменить default password, (2) exposить только на localhost + reverse-proxy, (3) использовать trusted-proxy-cidrs если trust header, (4) регулярно бэкапить `MIHARBOR_DATA_DIR/.vault-key`.

### 10.2. CSRF / CORS

**CSRF.** Basic Auth — без cookies/session, CSRF не применим. Если в v2 перейдём на session-cookies — вернём token.

**CORS.** Развёртка — single-origin (backend + статика с одного порта), CORS выключен в проде. В dev Vite проксирует `/api/*` на Elysia.

### 10.3. Секреты mihomo API + конфига

**`MIHOMO_API_SECRET` из ENV.** Из frontend'а никогда не виден — backend проксирует запросы к mihomo API. В логах — маскированно (`se***76`).

**Секреты из конфига mihomo.** Значения полей из `MIHARBOR_SECRET_FIELDS` (см. секцию 9) в ответах API заменяются на `***MASKED***`. Toggle-глаз в UI — запрос на `/api/config/unmask?field=<path>` с повторным Basic Auth challenge (даже если сессия активна — для защиты «открытого браузера»).

### 10.4. LLM — prompt injection + exfil защита (B5 ревью)

LLM-ассистент — опциональная фича с повышенным риском (любой запрос уходит на внешний API). Правила:

**Allow-list контекста (не deny-list).** Backend передаёт в LLM **только** белый список секций: `rules`, `proxy-groups` (названия + type, без `proxies`-массивов), `rule-providers` (только `name`, `type`, `behavior` — без `url`/`path`), meta конфига (`mode`, `log-level`). **Никогда** не передаются: `proxies` (ноды), `dns`, `tun`, `sniffer`, `external-controller`, `secret`, комментарии верхнего уровня (могут содержать креды). Аллой-лист — в `packages/shared/llm/context-allowlist.ts`, защищённый тестом.

**Explicit consent перед каждым запросом.** Модалка «LLM получит N строк из `rules` + `proxy-groups`, не получит `proxies`/`dns`/`secret`. Провайдер: Anthropic / OpenAI. Продолжить?». Галочка «не спрашивать в этой сессии» — только на 30 минут, не навсегда.

**Prompt injection через rule-provider содержимое.** Содержимое внешних rule-providers (типа `hagezi_pro`) **не** идёт в LLM-контекст (только метаданные — name, URL, TTL). Даже если пользователь попросит «проанализируй правила из hagezi» — backend отвечает «контент внешних provider'ов в LLM не передаётся, это защита от prompt injection».

**Kill-switch.** `MIHARBOR_LLM_DISABLED=true` в ENV — полностью выключает LLM-drawer и endpoint'ы. Для production/shared-инсталляций.

**Хранение ключей.** Приоритет: `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` ENV > ввод в UI (сохраняется в `MIHARBOR_DATA_DIR/secrets.json`, mode 600). Production-режим (`MIHARBOR_PRODUCTION=true`) — блокирует UI-ввод, разрешает только ENV.

**Валидация формата ключа при UI-вводе (M8 ревью).** Anthropic: regex `^sk-ant-[a-z0-9-_]{20,}$`. OpenAI: `^sk-(proj-)?[a-zA-Z0-9-_]{20,}$`. Если не match — UI отвергает ввод.

### 10.5. Git-hygiene + pre-commit

**`.gitignore`:**
```
.env*
!.env.example
**/secrets.json
**/secrets-vault.enc
**/.vault-key
**/auth.json
**/snapshots/
**/*.key
**/wg-*.conf
*.yaml.bak
.miharbor.lock
.miharbor.draft.yaml
.miharbor.test.yaml
```

**Pre-commit hook (P10 ревью).** `husky` + `lint-staged`. Запрещает коммит файлов с содержимым `private-key:`, `pre-shared-key:`, `^secret: "[a-f0-9]{32,}"` (regex). Защита от operator error.

### 10.6. SECURITY.md (P7 ревью)

Отдельный файл в корне репы. Содержит: disclosure process (email + PGP), threat model (главные векторы), supported versions.

**Threat model — основные векторы:**
1. **RCE через YAML parse** — `yaml@2.x` не поддерживает `!!js/function` и unsafe типы, безопасен. Но следим за CVE.
2. **Prompt injection через LLM context.** Митигация: allow-list, explicit consent.
3. **Secret exfil через snapshot history.** Митигация: sentinel-vault, шифрование, mode 600.
4. **Basic Auth bypass через trust-header spoof.** Митигация: `MIHARBOR_TRUSTED_PROXY_CIDRS`.
5. **SSH key abuse через unencrypted key.** Документация рекомендует `ssh-agent`.
6. **Race condition при параллельной записи.** Митигация: `flock` + хэш-проверка.
7. **Malicious Docker image supply chain.** Митигация: GHCR с signed images, SBOM в release assets.

---

### 10.7. i18n серверных сообщений (H10 ревью)

Серверные линтер-сообщения, error-response'ы, invariant-тексты, impact-preview-тексты — все используют i18n-ключи, не литералы. Architecture:
- `packages/shared/i18n/en.json`, `ru.json` — единый источник правды.
- Elysia ответ содержит `{ error: { code: 'LINTER_UNREACHABLE_RULE', params: { rule_index: 42, covered_by: 18 } } }`.
- Frontend по `code` + `vue-i18n` рендерит локализованный текст.
- Исключение — raw error strings из mihomo API (они передаются как-есть, с пометкой «raw output from mihomo»).

---

## 11. Наблюдаемость и operations

### 11.1. Логирование (P2 ревью)

- **Формат:** JSON-lines в stdout (Docker friendly). Structured fields: `ts`, `level`, `msg`, `trace_id`, `user`, `action`, `transport`.
- **Уровни:** `debug` (default for dev), `info` (default for prod), `warn`, `error`.
- **Что логируется:** каждый deploy-пайплайн с полным trace (этапы, длительности, rollback если был), линтер-issues (агрегированно, без содержимого), auth-события (успех/неуспех), LLM-запросы (без содержимого prompt, только счётчики токенов и стоимость).
- **Аудит-лог отдельно** (`MIHARBOR_DATA_DIR/audit.log`, append-only). Каждый deploy с `user`, `IP`, `User-Agent`, `snapshot_id`, `diff_summary`. Ротируется через `logrotate` по 30 дней.
- **Секреты в логах:** никогда. Маскируются фильтром `pino-redact`-style перед выводом.

### 11.2. Метрики (опционально)

Endpoint `GET /metrics` (Prometheus text format), отключается через `MIHARBOR_METRICS_DISABLED=true`. Минимальный набор:
- `miharbor_deploy_total{status="success|failure|rollback"}` counter
- `miharbor_deploy_duration_seconds{step}` histogram
- `miharbor_linter_issues{level,code}` gauge
- `miharbor_healthcheck_failures_total{phase}` counter
- `miharbor_snapshots_total` gauge
- `miharbor_llm_requests_total{provider}` counter

### 11.3. Continuous healthcheck mihomo (P13 ревью)

См. секцию 7. Backend поллит `GET /version` mihomo каждые 60 сек. Статус в хедере UI обновляется через SSE (`/api/health/stream`). Опционально Prometheus-метрика `miharbor_mihomo_up{}` для внешнего мониторинга.

---

## 12. Миграции и upgrade-path

### 12.1. Schema versioning данных Miharbor

- **`MIHARBOR_DATA_DIR/.schema-version`** — целое число. При старте backend проверяет, что schema match (`MIHARBOR_SCHEMA = 1` в коде).
- **Migration runner (P4 ревью):** в `apps/server/src/migrations/` — последовательные `migrate-01-to-02.ts`, `migrate-02-to-03.ts`. На старте backend запускает недостающие миграции в порядке + обновляет `.schema-version`.
- **Формат миграции:** идемпотентный. Примеры: переименовать поле в `secrets.json`, переформатировать snapshot metadata, обновить сериализацию vault.
- **Failed migration** — backend отказывается стартовать, оставляет понятное сообщение и требует ручной рестор из backup'а data-volume.

### 12.2. ENV-переменные deprecation (P3 ревью)

- При встрече deprecated имени — warning в логах + автоматический fallback на новое имя.
- Маппинг в `apps/server/src/env/deprecations.ts`.
- В следующей major-версии deprecated имена удаляются.

### 12.3. mihomo version compatibility (P5 ревью)

- CI matrix: тестируем Miharbor против `mihomo:1.18`, `1.19`, `1.20` (последние стабильные).
- README содержит раздел «Compatibility matrix».
- При старте backend дёргает `GET /version` у mihomo и логирует — если версия не в списке протестированных → warning «непроверенная версия, отчитайтесь о проблемах в GitHub Issues».

### 12.4. Backup-стратегия (P6 ревью)

Документируем в README + `docs/BACKUP.md`:
- Что бэкапить: `MIHARBOR_DATA_DIR` целиком (`snapshots/`, `.vault-key`, `secrets-vault.enc`, `secrets.json`, `auth.json`, `audit.log`).
- **Критично:** `.vault-key` — без него все снапшоты становятся нечитаемыми.
- Рекомендованный путь: `docker run --rm -v miharbor_data:/data -v $(pwd):/backup alpine tar czf /backup/miharbor-backup.tar.gz /data`.
- Crontab пример в README.

### 12.5. Behavior при пустом/отсутствующем конфиге (P11 ревью)

- **Файл конфига не существует:** UI показывает onboarding-экран «Новая установка mihomo», предлагает seed-конфиг из шаблона (minimal working config с `Остальной трафик → DIRECT` и пустым `proxies`). Пользователь заполняет и делает первый deploy.
- **Файл существует, но пустой:** аналогично onboarding, с предупреждением «файл пуст».
- **Файл существует, но не парсится:** UI показывает parse-error с line/column, предлагает (a) исправить через Raw YAML, (b) выбрать snapshot для отката.

---

## 13. Testing strategy (P1 ревью)

### 13.1. Уровни тестирования

- **Unit (`bun test`):** чистая логика — все линтеры в `packages/shared/linter/`, utilities, `yaml` canonicalization. Цель — 80%+ покрытие.
- **Integration (`bun test`):** транспорты против `InMemoryTransport` (LocalFs прогоняется в temp-директорию, Ssh mock'ается через `ssh2-mock` или docker-compose с sshd-container).
- **E2E (Playwright):** полные сценарии в docker-compose окружении с реальным mihomo-контейнером. «Добавил сервис → применил → deploy прошёл → откатился → проверил rollback работает».
- **Property-based тесты** (`fast-check`) для линтера #1 (unreachable) — критичный алгоритм, легко промахнуться с краевыми случаями.

### 13.2. Fixtures

- `packages/shared/fixtures/config-server.yaml` — реальный конфиг из этого проекта (анонимизированный — подмена IP, ключей, secret на placeholder'ы). **Golden test** — каждая PR прогоняет canonicalization + все линтер-проверки на этом fixture, ожидая стабильный snapshot.
- `packages/shared/fixtures/config-minimal.yaml` — seed-конфиг для onboarding.
- `packages/shared/fixtures/config-broken-*.yaml` — набор «битых» конфигов (unreachable rule, dangling ref, unknown group) для регрессионных тестов линтера.

### 13.3. CI

- GitHub Actions: `lint → typecheck → unit → integration → build → e2e`.
- E2E на matrix: Node 20 для Vite build, Bun 1.3.x для backend, mihomo `1.18` `1.19` `1.20`.
- Release workflow собирает multi-arch Docker image, подписывает SBOM, пушит в GHCR.

---

## 14. Структура репозитория (обновлено по B6 ревью)

```
miharbor/
├── README.md                  # English
├── README.ru.md               # Russian
├── LICENSE                    # MIT
├── docker-compose.example.yml
├── Dockerfile                 # multi-stage
├── .env.example
├── .github/
│   └── workflows/
│       ├── ci.yml             # lint + typecheck + test
│       └── release.yml        # build + push to GHCR
├── package.json               # workspaces root
├── bun.lockb
├── apps/
│   ├── web/                   # Vue 3 + Vite
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── App.vue
│   │   │   ├── pages/
│   │   │   │   ├── Services.vue
│   │   │   │   ├── Proxies.vue
│   │   │   │   ├── Providers.vue
│   │   │   │   ├── Dns.vue
│   │   │   │   ├── Tun.vue
│   │   │   │   ├── Sniffer.vue
│   │   │   │   ├── Profile.vue
│   │   │   │   ├── RawYaml.vue
│   │   │   │   ├── History.vue
│   │   │   │   └── Settings.vue
│   │   │   ├── components/
│   │   │   │   ├── layout/ (AppShell, Sidebar, Header, DeployStepper, DiffViewer)
│   │   │   │   ├── rules/ (RuleRow, RuleEditor, ServiceList, ServiceDetail)
│   │   │   │   ├── smart/ (IssueList, ImpactBanner, TemplateSuggester, LlmDrawer)
│   │   │   │   └── ui/ (shadcn-vue primitives)
│   │   │   ├── stores/ (config.ts, deploy.ts, auth.ts, settings.ts)
│   │   │   ├── i18n/ (en.json, ru.json)
│   │   │   └── api/ (typed client, generated from Elysia schemas)
│   │   ├── vite.config.ts
│   │   └── package.json
│   └── server/                # Bun + Elysia
│       ├── src/
│       │   ├── index.ts         # entry
│       │   ├── bootstrap.ts     # transport selection, config load, schema migration
│       │   ├── env/
│       │   │   ├── schema.ts    # TypeBox schema for all ENV vars
│       │   │   └── deprecations.ts
│       │   ├── auth/            # basic-auth middleware + trust-proxy logic
│       │   ├── vault/           # sentinel-vault (AES-256-GCM, sentinel resolve/mask)
│       │   ├── transport/
│       │   │   ├── transport.ts (interface)
│       │   │   ├── local-fs.ts
│       │   │   ├── ssh.ts
│       │   │   └── in-memory.ts (tests)
│       │   ├── config/
│       │   │   ├── loader.ts    # yaml Document
│       │   │   ├── views/       # projections per section
│       │   │   ├── mutator.ts   # apply edits to Document
│       │   │   └── canonicalize.ts # format-only normalization
│       │   ├── deploy/
│       │   │   ├── pipeline.ts
│       │   │   ├── snapshot.ts
│       │   │   ├── rollback.ts
│       │   │   └── healthcheck.ts
│       │   ├── lock/            # flock wrapper (proper-lockfile, SSH exec)
│       │   ├── mihomo/
│       │   │   ├── api-client.ts
│       │   │   └── validator.ts # calls transport.runMihomoValidate
│       │   ├── linter-server/   # server-only linter checks (#4 geosite, #6 dns, #8 preflight)
│       │   │   ├── dns-lookup.ts
│       │   │   ├── geosite-match.ts
│       │   │   ├── geoip-loader.ts
│       │   │   └── preflight.ts
│       │   ├── llm/
│       │   │   ├── anthropic.ts
│       │   │   ├── openai.ts
│       │   │   ├── context-builder.ts # allow-list, strips secrets
│       │   │   └── patch-applier.ts
│       │   ├── migrations/      # schema migration runner (P4)
│       │   │   ├── runner.ts
│       │   │   └── migrate-01-to-02.ts  # examples, empty at MVP
│       │   ├── observability/
│       │   │   ├── logger.ts    # pino with redaction
│       │   │   ├── audit-log.ts
│       │   │   └── metrics.ts   # prometheus
│       │   ├── health-monitor.ts # continuous mihomo healthcheck (P13)
│       │   └── routes/          # Elysia routes grouped per UI section
│       └── package.json
└── packages/
    └── shared/
        ├── types/               # Service, Rule, ProxyNode, DnsConfig, Issue, etc.
        ├── linter/              # shared linters (#1, #2, #3, #5, #7 templates)
        │   ├── unreachable.ts
        │   ├── invariants-universal.ts
        │   ├── invariants-user.ts
        │   ├── duplicates.ts
        │   ├── placement.ts
        │   ├── impact.ts
        │   └── index.ts
        ├── llm/
        │   └── context-allowlist.ts # what sections can be sent to LLM
        ├── templates/
        │   ├── services.json    # ~200 service templates (i18n descriptions)
        │   ├── impact-templates.json
        │   └── invariants-universal.json
        ├── fixtures/            # test fixtures
        │   ├── config-server-anonymized.yaml
        │   ├── config-minimal.yaml
        │   └── config-broken-*.yaml
        ├── i18n/                # shared translation keys
        │   ├── en.json
        │   └── ru.json
        └── geodata/
            └── mrs-reader.ts    # .dat/.mrs format reader for GEOSITE lookup
```

---

## 15. Out of scope / будущие итерации

- **Multi-user / RBAC.** Нужен один пользователь через Basic Auth. Если кому-то надо больше — Authelia/Authentik перед Miharbor.
- **Мобильная адаптация.** Responsive верхнего уровня (≥768px, tablet). Телефоны — не приоритет.
- **Offline PWA.** Нет смысла при постоянно онлайн-сценарии.
- **Live traffic view.** Zashboard это делает, не дублируем.
- **Автоматическое обновление geosite.dat при старте.** Пока ручная кнопка в UI — достаточно.
- **Plugin-система.** Вынесение smart-checks в плагины — потенциально в v2, если сообщество соберётся вокруг проекта.
- **Мульти-сервер.** Один экземпляр Miharbor = один mihomo. Если у тебя три роутера — три контейнера (или три вкладки локального режима). Мультиконтекст — v2.
- **Интеграция с Home Assistant.** Тумблер «VPN on/off» в HA через HTTP API Miharbor. Не обязательно, но документируем endpoint.
- **Tree-editor для AND/OR правил** — в этапе 2.
- **Raw YAML full edit** — в этапе 2 (в этапе 1 только read-only view).

---

## 16. Фазирование реализации

**Этап 0 — PoC (завершён 2026-04-16):**
- ✓ `yaml`-library round-trip проверен на `config-server.yaml`, подтверждён подход canonicalize-first.
- ✓ Design v2 с учётом code-review.

**Этап 1 — ядро (MVP):**
- Monorepo каркас + CI + migration runner + observability (logger, metrics, audit).
- Docker-режим + LocalFsTransport + sentinel-vault + flock.
- Экран «Сервисы» (master-detail) + экран «Прокси-ноды» (минимум: просмотр, WireGuard add/edit).
- **Raw YAML в read-only режиме** (решение H3) — для AND/OR и экспертного обзора.
- Deploy-пайплайн все 6 шагов + snapshots + rollback + continuous healthcheck.
- Smart-checks 1 (unreachable), 2 (invariants universal), 3 (duplicates), 8 (preflight через transport).
- Basic Auth + brute-force rate-limit + i18n каркас (EN первый, RU следом).
- SECURITY.md + onboarding-экран при пустом конфиге.

**Этап 2 — полнота покрытия:**
- Экраны DNS, TUN, Sniffer, Профиль, Rule-providers, История.
- Raw YAML **в edit-режиме** (full Monaco с schema-hints).
- Tree-editor для AND/OR правил.
- Smart-checks 4 (templates), 5 (placement), user-defined invariants (2b).
- SshTransport + документация по sudoers.
- Полная RU-локализация.

**Этап 3 — умности высокого уровня:**
- Smart-checks 6 (DNS lookup + GEOIP), 7 (impact preview), 9 (LLM-ассистент с allow-list + consent).
- Импорт нод из URL (vless/ss/vmess/trojan/wg).
- Полноценный README + демо-гифки + ссылки в сообществах mihomo + Docker Hub mirror.

---

## 17. Ответы на открытые вопросы

1. **Фазирование:** этапы 0 → 1 → 2 → 3 утверждены.
2. **README:** EN + RU паритетно, со скриншотами, quick-start, примером `docker-compose.yml`. Логотип откладываем.
3. **Лицензия:** **MIT**.
4. **Образ:** **GHCR** основной, Docker Hub как mirror. Репо — **`github.com/Matrix-aas/miharbor`** (`git@github.com:Matrix-aas/miharbor.git`).
5. **Reload fallback:** крайний fallback — `sudo systemctl restart mihomo` (mihomo на сервере — systemd unit, не Docker). ~5 сек downtime честно предупреждаем в UI.
6. **Canonicalization при первом импорте:** разовое format-only изменение (PoC подтвердил безопасность), сохраняется в отдельный snapshot `applied_by: 'canonicalization'`.
7. **Валидация через вшитый mihomo:** отказались (версионные расхождения). Вместо этого — используем тот же mihomo что на сервере через SSH/docker exec/API.

---

## 18. История ревизий

- **v1 (2026-04-16)** — первоначальный draft после брейнсторма.
- **v2 (2026-04-16)** — после code-review и PoC. Закрыто: B1 (sentinel-vault), B2 (flock), B3 (ssh-agent+sudo), B4 (polling healthcheck), B5 (LLM allow-list), B6 (shared vs server split), B7 (yaml canonicalization PoC). Все high-priority и missing пункты адресованы. Готова к написанию плана реализации.
