# Miharbor Implementation Plan — Overview

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Построить Miharbor — визуальный open-source редактор конфига mihomo — поэтапно от MVP до полнофункционального публичного инструмента с LLM-ассистентом.

**Архитектура:** Bun + Elysia backend + Vue 3 frontend в монорепо. Volume-mount или SSH-транспорт до серверного mihomo. YAML-Document как источник истины с canonicalize-first подходом. Sentinel-vault для секретов в снапшотах. 9 умных проверок разделены на shared (клиент+сервер) и server-only линтеры.

**Tech Stack:** Bun 1.3+, Elysia, Vue 3 (Composition API), TypeScript strict, Vite, Tailwind + shadcn-vue, Pinia, Monaco Editor, `yaml` (Eemeli Aro), `ssh2`, `proper-lockfile`, Argon2id через `Bun.password`, AES-256-GCM для vault, node-cron.

**Спецификация:** `docs/superpowers/specs/2026-04-16-miharbor-design.md` (v2, после code-review + PoC).

**Репозиторий:** `git@github.com:Matrix-aas/miharbor.git`.

---

## Структура плана

План разбит на файлы по этапам (каждый — самодостаточный, с отдельной Task-persistence):

| # | Файл | Описание | Длительность |
|---|---|---|---|
| **0** | (выполнено, см. `poc-yaml/`) | PoC canonicalization | 2026-04-16 ✓ |
| **1** | [`2026-04-16-miharbor-stage-1-core.md`](./2026-04-16-miharbor-stage-1-core.md) | **MVP**: Docker, LocalFs-транспорт, экран Сервисы + Ноды + Raw-YAML (read-only) + История, Deploy-пайплайн с snapshot/rollback/vault, линтеры 1/2/3/8, Basic Auth, EN-локаль, publish to GHCR. | 35 задач |
| **2** | [`2026-04-16-miharbor-stage-2-coverage.md`](./2026-04-16-miharbor-stage-2-coverage.md) | **Полнота покрытия**: DNS/TUN/Sniffer/Rule-providers экраны, Raw YAML full-edit, tree-editor AND/OR, SshTransport, линтеры 4/5 + user-defined invariants, RU-локаль. | ~20 задач |
| **3** | [`2026-04-16-miharbor-stage-3-smart.md`](./2026-04-16-miharbor-stage-3-smart.md) | **Умности**: линтер 6 (DNS+GEOIP), линтер 7 (impact), линтер 9 (LLM-ассистент allow-list + consent), импорт нод из URL, демо-материалы. | ~15 задач |

---

## Ключевые принципы

- **TDD внутри каждой задачи.** Test-first, минимальная реализация, зелёный, коммит. Детальные red/green/refactor циклы — внутри задачи, не как отдельные задачи.
- **Frequent commits.** Каждая задача → один коммит с conventional-commit заголовком.
- **Acceptance criteria testable.** Если нельзя проверить — это не AC, это wishful thinking.
- **DRY + YAGNI.** Первая реализация — минимальная, не изобретаем гибкость наперёд.
- **Файл имеет одну ответственность.** Большой файл → сплит. Новые концерны → новые файлы (но без over-engineering).

---

## Порядок выполнения

1. Этап 1 полностью → MVP публикуется в GHCR как `v0.1.0`.
2. Только после этого этап 2 → `v0.2.0`.
3. Этап 3 → `v1.0.0`.

Между этапами — пауза на реальное использование MVP (минимум 1 неделя) — ловим тупые ошибки дизайна которые не видны в ревью.

---

## Глобальные инварианты (не нарушаем в любой задаче)

1. **Секреты не попадают в логи, snapshots-diff, LLM-контекст.** Тест-кейсы в каждом модуле где работаем с конфигом.
2. **Любая запись в конфиг — атомарная (tmp на том же mount + rename).**
3. **Любая запись — под `flock` на lock-файле.**
4. **Любое reload mihomo — с healthcheck после.**
5. **yaml canonicalization — не меняет семантику (JSON.stringify до/после идентичен).**
6. **i18n — ни одной user-facing строки в коде, только i18n-ключи.**
7. **Пинуем все зависимости в package.json (`~`, не `^`). Image tags — фиксированные.**

---

## Метрики готовности этапа

**Этап готов когда:**
- Все задачи `completed` в TaskList.
- `bun test` зелёный по всему монорепо.
- `bun run build` собирается без ворнингов.
- Docker image собирается, `docker compose up` поднимает здоровый контейнер.
- Smoke-scenario из README работает end-to-end (запустил → вошёл → отредактировал → применил → увидел в mihomo).
- code-review по плану (отдельный шаг после этапа) — без открытых блокеров.
- Релиз в GHCR с SBOM.

---

## История версий плана

- **v1 (2026-04-16)** — первая редакция после утверждения design v2.
