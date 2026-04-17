# Miharbor

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE) [![Docker](https://img.shields.io/badge/ghcr.io-miharbor-blue)](https://github.com/matrix-aas/miharbor/pkgs/container/miharbor) [English](./README.md)

Визуальный редактор конфигов [mihomo](https://github.com/MetaCubeX/mihomo) (Clash-совместимый прокси). Запускается рядом с mihomo-демоном, даёт типизированный UI для сервисов, прокси-групп, правил и WireGuard-нод. Деплоит изменения через шестишаговый пайплайн с автоматическим rollback'ом и шифрованной историей снапшотов.

## Возможности

- **Типизированный UI** для всех основных секций конфига mihomo: сервисы, прокси-группы, правила, rule-provider'ы, WireGuard-ноды. Править YAML руками не нужно (но Raw Monaco view доступен в режиме read-only).
- **Шестишаговый deploy-пайплайн** с поэтапной валидацией, проверкой healthcheck и автоматическим rollback'ом, если mihomo не поднялся после применения.
- **Шифрованная история снапшотов** — каждый деплой создаёт сжатый AES-256-GCM-запечатанный снапшот. Полный diff, rollback в один клик, настраиваемое удержание (по количеству + по дням).
- **Умный линтинг** — ловит недостижимые правила, дублирующиеся имена групп, висячие ссылки и нарушения инвариантов mihomo **до** деплоя.
- **Docker-first** — один контейнер, прибитая версия, multi-arch (amd64 + arm64).
- **Гигиена секретов** — поля `secret:`, `private-key:`, `pre-shared-key:` маскируются в UI по умолчанию и шифруются на диске в истории.
- **EN / RU** интерфейс.

## Скриншоты

_(TODO — см. `docs/screenshots/` в будущих релизах.)_

## Быстрый старт (Docker)

```bash
# 1. Скачайте пример compose и шаблон env.
curl -O https://raw.githubusercontent.com/matrix-aas/miharbor/main/docker-compose.example.yml
curl -O https://raw.githubusercontent.com/matrix-aas/miharbor/main/.env.example
mv docker-compose.example.yml docker-compose.yml
mv .env.example .env

# 2. Сгенерируйте три обязательных секрета.

# Mihomo REST API Bearer — то же значение, что в поле `secret:` mihomo.
echo "MIHOMO_API_SECRET=$(grep -E '^secret:' /etc/mihomo/config.yaml | awk '{print $2}' | tr -d '\"')" >> .env

# Argon2id-хэш админского пароля.
PASSWORD="change-me-now"
HASH=$(docker run --rm oven/bun:1.3.11-alpine \
  bun -e "console.log(await Bun.password.hash(\"$PASSWORD\"))")
echo "MIHARBOR_AUTH_PASS_HASH=$HASH" >> .env

# Ключ шифрования истории снапшотов (32 байта hex).
echo "MIHARBOR_VAULT_KEY=$(openssl rand -hex 32)" >> .env

# 3. Запуск.
docker compose up -d

# 4. Поставьте reverse-proxy (nginx/caddy/traefik) перед 127.0.0.1:3000
#    с TLS и откройте https://miharbor.yourdomain/.
```

Логин: `admin` + пароль, который вы выбрали выше.

## Production-чеклист

Прочитайте до того, как выставлять Miharbor за пределы `localhost`.

- [ ] **Поменяйте админский пароль.** Если `MIHARBOR_AUTH_PASS_HASH` пуст, Miharbor стартует с обязательным экраном смены пароля — не игнорируйте его.
- [ ] **Поставьте reverse-proxy впереди.** `127.0.0.1:3000` — это задуманный режим; публичные порты принимают nginx/caddy/traefik с TLS.
- [ ] **Сделайте бэкап `MIHARBOR_VAULT_KEY`.** Без него вся история снапшотов нечитаема. Храните копию вне volume `miharbor_data`.
- [ ] **Бэкапьте `MIHARBOR_DATA_DIR`.** См. [`docs/BACKUP.md`](./docs/BACKUP.md).
- [ ] **Задайте `MIHARBOR_TRUSTED_PROXY_CIDRS`, если используете trust-headers.** Без него любой, кто достучится до контейнера, пошлёт `X-Forwarded-User: admin` и обойдёт auth. По умолчанию пусто = trust отключён, это безопасно.
- [ ] **Рассмотрите WAF / brute-force layer** — внутренний rate-limiter по IP на `/api/auth/*` в Miharbor есть, но CrowdSec / Authelia перед reverse-proxy — надёжнее.

## Архитектура

```
 ┌──────────────────┐      HTTPS (через reverse-proxy)
 │    Браузер       │ ◀──────────────────────────────┐
 └──────────────────┘                                │
                                                     │
                                      ┌──────────────┴───────────┐
                                      │ Miharbor (Docker)        │
                                      │  ┌─────────────────────┐ │
                                      │  │ Elysia (Bun) :3000  │ │
                                      │  │  /api + статика SPA │ │
                                      │  └──────────┬──────────┘ │
                                      │             │            │
                                      │  bind-mount /config      │
                                      │  (mihomo config.yaml)    │
                                      │             │            │
                                      └─────────────┼────────────┘
                                                    │ reload через REST
                                      ┌─────────────▼────────────┐
                                      │  mihomo (host / другое)  │
                                      └──────────────────────────┘
```

Miharbor не правит процесс mihomo напрямую — он пишет `/config/config.yaml` (bind-mounted) и зовёт `PUT /configs?force=true` на REST API mihomo, чтобы триггернуть reload. Rollback использует тот же механизм: восстанавливает YAML предыдущего снапшота на диск и делает reload.

## Режимы (транспорты)

- **Docker + LocalFs** _(v0.1, по умолчанию)_ — Miharbor в контейнере, bind-mount директории с конфигом mihomo. Самый короткий путь до рабочей установки.
- **SSH** _(запланировано, v0.2)_ — Miharbor на jump-хосте, деплой на удалённый mihomo через SSH. Интерфейс транспорта уже абстрагирован, осталось только реализовать SSH.

## Поддерживаемые версии mihomo

CI smoke-тестирует три текущих: **1.18.x, 1.19.x, 1.20.x**. По факту любая пост-1.18 сборка с `/configs` REST endpoint'ом работает. Старые `clash.meta` могут работать, но не тестированы.

## Конфигурация

Всё конфигурируется через environment-переменные.

| Переменная                          | Default                            | Назначение                                                           |
| ----------------------------------- | ---------------------------------- | -------------------------------------------------------------------- |
| `MIHARBOR_PORT`                     | `3000`                             | HTTP-порт внутри контейнера.                                         |
| `MIHARBOR_TRANSPORT`                | `local`                            | `local` (bind-mount) или `ssh` (планируется).                        |
| `MIHARBOR_CONFIG_PATH`              | `/config/config.yaml`              | Путь к конфигу mihomo в контейнере.                                  |
| `MIHARBOR_DATA_DIR`                 | `/app/data`                        | Собственное состояние Miharbor (snapshots, vault, auth).             |
| `MIHARBOR_WEB_DIST`                 | _(задано в образе)_                | Директория с пре-билдом Vue-бандла. Пусто = API-only.                |
| `MIHOMO_API_URL`                    | `http://host.docker.internal:9090` | mihomo REST API.                                                     |
| `MIHOMO_API_SECRET`                 | _(пусто, обязательно)_             | Bearer-токен mihomo REST API.                                        |
| `MIHARBOR_AUTH_USER`                | `admin`                            | Имя админа.                                                          |
| `MIHARBOR_AUTH_PASS_HASH`           | _(пусто)_                          | Argon2id-хэш. Пусто = bootstrap-режим (форсирует смену пароля).      |
| `MIHARBOR_AUTH_DISABLED`            | `false`                            | Dev-escape-hatch. Никогда не включайте в production.                 |
| `MIHARBOR_VAULT_KEY`                | _(пусто, обязательно)_             | 32-байтный hex-ключ AES-256-GCM для vault'а.                         |
| `MIHARBOR_TRUST_PROXY_HEADER`       | _(пусто)_                          | Имя header'а для trust-identity (например, `X-Forwarded-User`).      |
| `MIHARBOR_TRUSTED_PROXY_CIDRS`      | _(пусто)_                          | CIDR'ы, которым разрешено ставить trust-header.                      |
| `MIHARBOR_SNAPSHOT_RETENTION_COUNT` | `50`                               | Удерживать не более N последних снапшотов.                           |
| `MIHARBOR_SNAPSHOT_RETENTION_DAYS`  | `30`                               | Удалять снапшоты старше N дней.                                      |
| `MIHARBOR_AUTO_ROLLBACK`            | `true`                             | Если healthcheck после deploy'а падает — восстанавливать предыдущий. |
| `MIHARBOR_LOG_LEVEL`                | `info`                             | `debug` / `info` / `warn` / `error`.                                 |
| `MIHARBOR_LLM_DISABLED`             | `false`                            | Прячет LLM-ассистента (планируется в v0.2+).                         |

## Разработка

Требования: [Bun 1.3.11+](https://bun.sh/).

```bash
git clone https://github.com/matrix-aas/miharbor
cd miharbor
bun install

# Терминал 1 — сервер (Elysia :3000)
MIHARBOR_AUTH_DISABLED=true \
MIHARBOR_DATA_DIR=./.local-data \
MIHARBOR_CONFIG_PATH=./.local-data/config.yaml \
MIHARBOR_VAULT_KEY=00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff \
bun run server:dev

# Терминал 2 — Vite dev server (:5173, проксирует /api в :3000)
bun run web:dev

# Тесты
bun test                           # server + shared
bun run --filter miharbor-web test # web (Vitest)
```

См. [`docs/superpowers/plans/`](./docs/superpowers/) для поэтапного плана имплементации.

## Roadmap

- **v0.1 (MVP — текущая)**: Services, Proxies, Raw YAML (read-only), History с rollback'ом, Settings, Onboarding. Только LocalFs-транспорт.
- **v0.2**: Полный UI для DNS / TUN / Sniffer / Rule-providers, SSH-транспорт, полный RU-перевод, tree-mode AND/OR билдер правил.
- **v1.0**: LLM-assisted рефакторинг, DNS+GEOIP-линтер, import нод из URL, automation API.

## Безопасность

См. [`SECURITY.md`](./SECURITY.md) — threat model и процесс disclosure.

## Лицензия

[MIT](./LICENSE).
