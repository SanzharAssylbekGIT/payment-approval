# Brave Talents — Платежи и проектный учёт

Внутренняя система согласования платежей и управленческого учёта.
ТЗ — [CLAUDE.md](CLAUDE.md). Архитектурные решения — [DECISIONS.md](DECISIONS.md).

## Стек

Next.js 15 (App Router, TS) · Prisma · PostgreSQL 16 (Docker) · Tailwind · bcryptjs + сессии.

## Запуск (разработка)

```bash
# 1. Поднять БД
npm run db:up          # docker compose up -d db

# 2. Применить миграции и сгенерировать клиент
npm run db:migrate

# 3. Заполнить тестовыми данными
npm run db:seed

# 4. Dev-сервер
npm run dev            # http://localhost:3000
```

Скопируй `.env.example` → `.env` (в dev значения по умолчанию уже подходят).

## Тестовые учётные данные

Пароль у всех: **`password123`**

| E-mail | Кто | Роли |
|---|---|---|
| sanzhar.assylbek@bravetalents.com | Санжар (CFO) | видит всё, админ |
| zhadyra.kassymbek@bravetalents.com | Жадыра (гл. бух) | согласует ЗП/дивиденды, коллегия |
| ainur.abduvali@bravetalents.com | Айнур (опер. директор) | согласующий, коллегия |
| rakhima.turzhanova@bravetalents.com | Рахима | согласует блогеров |
| blogger.staff@bravetalents.com | Сотрудник блог-отдела | заявитель |

(полный список — в `prisma/seed.ts`, справочник — CLAUDE.md §13)

## Полезные команды

```bash
npm run db:studio      # Prisma Studio — просмотр БД
npm run db:reset       # сброс БД + повторный сид
npm run build          # production-сборка (standalone, для деплоя)
```

## Прогресс (очередность — CLAUDE.md §14)

- [x] **Этап 1.** Каркас: Next.js + Prisma + Postgres в Docker, docker-compose.
- [x] **Этап 2.** Модель данных: полная Prisma-схема + миграция + сид.
- [x] **Этап 3.** Авторизация: логин/пароль, роли, RBAC, абстракция под SSO.
- [x] **Этап 4.** Система А: подача заявок → маршрутизация → многоступенчатое
      согласование → жизненный цикл статусов, аудит, вложения.
- [x] **Этап 5.** Казначейство: реестр на оплату (приоритизация), платёжный
      календарь, отметка «оплачено» → проводка выплаты.
- [x] **Этап 6.** Система Б: проектный учёт 7366 (Клиент→Проект→Получатель,
      план-факт), депозиты/резервы, разнос поступлений по смете, спецпроекты 0175.
- [x] **Этап 7.** Бюджет 6890 (план-факт), дашборды, ежемесячный отчёт.
- [x] **Этап 8.** Админка: пользователи/роли, просмотр видов расходов и маршрутов.

### Проверка логики

```bash
npm run test:accounting   # тесты финансового движка (разнос, выплаты, балансы)
npm run demo:scenario     # наполнить сквозной демо-сценарий (живые данные)
```

## Деплой (инструкция для IT)

Прод-конфигурация уже в репозитории: `Dockerfile` (standalone-сборка),
`docker-compose.yml` (профиль `deploy`), `vercel-build` в package.json.

### Вариант A — Vercel + Supabase (облако; частично настроен)

1. Supabase: создать проект (регион Frankfurt), сохранить пароль БД.
   Кнопка **Connect → ORMs (Prisma)** даст две строки подключения.
2. Vercel → Settings → Environment Variables:
   - `DATABASE_URL` — пул-строка (порт **6543**, с `?pgbouncer=true`)
   - `DIRECT_URL` — прямая строка (порт **5432**)
   - `SESSION_SECRET` — `openssl rand -base64 48`
   - `AUTH_PROVIDER` — `credentials`
3. Redeploy — миграции применятся сами (`vercel-build` = `prisma migrate deploy && next build`).
4. Первичные данные (один раз, с любой машины с Node 20+, подставив в `.env`
   ОБЛАЧНЫЕ строки — в обе переменные прямую, порт 5432):
   ```bash
   npm ci
   npm run db:seed                                  # люди, роли, маршруты, виды расходов
   npm run bloggers:import -- "прайс-блогеров.xlsx" # база блогеров
   npx tsx scripts/import-budget.ts "бюджет.xlsx" 2026 7   # план бюджета (и 8..12)
   ```
5. ⚠️ Ограничение Vercel: **файлы-вложения заявок не сохраняются** (одноразовый
   диск serverless). До перехода на объектное хранилище (Supabase Storage —
   в планах) вложениями не пользоваться.

### Вариант B — офисный сервер (Docker, рекомендуется)

1. `git clone`, скопировать `.env.example` → `.env`, задать боевые значения:
   `POSTGRES_PASSWORD` (сильный), `SESSION_SECRET` (`openssl rand -base64 48`).
   `DATABASE_URL`/`DIRECT_URL` оставить `localhost:5432` — это для миграций
   с хоста; контейнер приложения получает свои строки внутри compose.
2. `docker compose up -d db`
3. Миграции и первичные данные с хоста (Node 20+):
   ```bash
   npm ci
   npx prisma migrate deploy
   npm run db:seed
   npm run bloggers:import -- "прайс-блогеров.xlsx"
   npx tsx scripts/import-budget.ts "бюджет.xlsx" 2026 7   # и остальные месяцы
   ```
4. `docker compose --profile deploy up -d --build` → приложение на `:3000`.
   Вложения заявок живут в томе `bt_uploads` — пересборку переживают.
5. Поверх — reverse-proxy с HTTPS (nginx/caddy) на `:3000`.
6. Бэкапы (cron, ежедневно):
   `docker exec bt_payments_db pg_dump -U bt bt_payments > backup_$(date +%F).sql`

### Чек-лист перед допуском сотрудников

- [ ] `SESSION_SECRET` — уникальный случайный (не из примера)
- [ ] Пароль Postgres сменён с dev-значения
- [ ] ⚠️ Пароли пользователей: сид ставит всем `password123` — сменить
      (блок «личные пароли + смена при первом входе» — в ближайших планах)
- [ ] `npm run db:reset` и `npm run demo:scenario` на проде НЕ запускать
      (сброс базы / демо-данные)
- [ ] Репозиторий на GitHub — приватный
- [ ] Обновление версии: `git pull` → `docker compose --profile deploy up -d --build`
      (миграции: `npx prisma migrate deploy` перед перезапуском)
