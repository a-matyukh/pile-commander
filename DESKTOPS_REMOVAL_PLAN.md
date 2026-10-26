# План: убрать десктопы и окна из продукта

Ведущий и ревьюер: Claude. Ревью плана и исполнение: Cursor.
Ветка: `v2.2.2`. Каждый этап — отдельный коммит; после каждого Claude
проверяет коммит по коду и прогоняет тесты.

Исходный план удаления — раздел «Removal plan» в
[DESKTOPS_EXPERIMENT.md](prototypes/desktop-environment/DESKTOPS_EXPERIMENT.md). Этот документ его заменяет.
Версия 2: учтено ревью Cursor (сверено с кодом и SQL).

## Контекст

- **Идея сохраняется как UI-прототип** в `prototypes/desktop-environment`:
  без бэкенда, на фейковых данных. Прототип не должен задерживать удаление:
  если он разрастается, ценное уже есть в скриншотах и в
  DESKTOPS_EXPERIMENT.md.
- **В облаке два пользователя** (владелец и друг). Данные не переносим
  кодом: каждый сам перекладывает нужное. Схему удаляем прямыми diff'ами в
  этой задаче — осознанное исключение из правил production в AGENTS.md,
  согласованное с владельцем.
- **Базу не пересоздаём**: потеряли бы публикации Hub, профили и ссылки
  `/<user>/<slug>`.

## Порядок и гейты

> Статус 2026-10-26: этапы 1–3 закоммичены (`129a592`, `99b1c7b`,
> `1b55bc9`, `84c93a5`, `8c2ead0`). Релиз десктопного приложения отложен
> до общего релиза v2.2.2. Этап 4 владелец решил делать сейчас, целиком,
> до релиза — см. «Этап 4 до релиза: что ломается у старой версии».

| # | Что | Гейт перед началом |
| --- | --- | --- |
| 0 | данные, бэкап, подсчёт | — |
| 1 | UI-прототип и скриншоты | — |
| 2 | клиент без десктопов и без фильтра `is_system` | скриншоты сняты |
| 3 | лендинг и документы | — |
| 4 | один diff `drop-desktops.sql`: десктопы и `is_system` | бэкап; системных рабочих пространств нет |

### Этап 4 до релиза: что ломается у старой версии

Старая версия (установленные приложения и сайт, пока он собирается из
`main`) фильтрует список облачных рабочих пространств
`.eq('is_system', false)` (`store/cloud.ts`, `fetch_workspaces`). После
`drop column is_system` этот запрос падает: у вошедшего пользователя
старой версии список облачных рабочих пространств пуст, в панели аккаунта
— ошибка. Данные не теряются; после обновления список возвращается.

Владелец принял это осознанно (2026-10-26): у друга облачных рабочих
пространств нет, владелец не открывает приложение до релиза, регистрация
новых пользователей временно закрыта. Публичные страницы (Hub, `/<user>/<slug>`, демо) список не
запрашивают и продолжают работать — проверить после применения.

Почему хватает одной версии клиента. Ревью предлагало две (A с фильтром,
B без), чтобы при живых системных строках в списке не появилось
неудаляемое рабочее пространство `system`. Подсчёт этапа 0 вернул ноль
строк: системных рабочих пространств нет ни у кого. Значит, фильтр можно
убрать уже на этапе 2. Diff сам проверяет, что строк по-прежнему нет
(предохранитель в начале).

## Этап 0. Данные, бэкап, подсчёт (делают люди)

> Статус 2026-10-26: п. 1 не нужен — владелец подтвердил, что в облачных и
> браузерных десктопах ничего не было. П. 3 выполнен: «No rows returned» —
> системных рабочих пространств нет. П. 2 (бэкап) — перед этапом 4.

1. Оба пользователя включают десктопы (Settings → Experimental → Show
   desktops and windows) и переносят нужное в обычные рабочие пространства:
   - **файлы прямо на облачном десктопе** — пропадут: они в скрытом
     системном рабочем пространстве;
   - **браузерные десктопы** (web, IndexedDB) — станут недоступны;
   - рабочие пространства на облачном десктопе уже есть в общем списке;
   - локальные десктопы — папки на диске (`~/Pile Commander/desktops/<id>`
     или выбранная), останутся на месте.
2. Бэкап: Supabase dashboard → Database → Backups или `pg_dump` через
   Session pooler. Этот же дамп — для репетиции diff'ов.
3. Подсчёт содержимого системных рабочих пространств, **включая корзину**
   (`desktops_experiment_report()` для этого недостаточно: он не видит
   `deleted_at` и саму папку `/desktop-<id>`):

   ```sql
   select w.owner_id,
          count(e.id) filter (where e.deleted_at is null and e.parent_id is not null) as live,
          count(e.id) filter (where e.deleted_at is not null) as trashed,
          count(e.storage_key) as blobs
     from public.workspaces w
     left join public.entries e on e.workspace_id = w.id
    where w.is_system
    group by w.owner_id;
   ```

   Всё, что здесь осталось, будет удалено на этапе 4 безвозвратно.
   Владельцы смотрят на цифры и подтверждают.

## Этап 1. UI-прототип `prototypes/desktop-environment`

Коммит: «prototype: desktop environment on fake data».

### Скриншоты — первым делом

До любого коммита этапа 2, пока переключатель работает
(`bun run dev:web`): десктоп с двумя окнами и панелью задач, вкладки,
полноэкранное окно, контекстное меню десктопа, меню Start. PNG в
`prototypes/desktop-environment/screenshots/`, каждый до ~300 KB.

### Форма

Самодостаточный `index.html` (можно с `app.js` и `styles.css` рядом):
vanilla JS и CSS, без сборки, без зависимостей и CDN, открывается двойным
щелчком из Finder. Устроен как прототип файлового менеджера: объект
состояния, `render()`, делегированные обработчики по `data-*`.
Перетаскивание и изменение размера — pointer events. Иконки — inline SVG.
Состояние в `localStorage` под ключом `desktop-env-prototype`, кнопка
«Reset» возвращает фейковые данные.

Две технические ловушки:

- **Не использовать `<script type="module">` и `import`.** Chrome блокирует
  модули на `file://`, двойной щелчок даст пустую страницу. Файлы
  подключать обычными `<script src>` и `<link>`.
- **Не вызывать `render()` во время перетаскивания.** Пока окно или иконку
  тащат, менять только `style` этого элемента; в состояние записать и
  перерисовать на `pointerup`.

Код из `apps/client` не переносить: он завязан на store, Nuxt UI и Tauri.
Вид и поведение — по скриншотам и DESKTOPS_EXPERIMENT.md.

### Что должно работать

- **Вкладки десктопов**: переключение, «+» (Local, Browser, Cloud — только
  значок типа), меню «…»: Rename, Remove.
- **Поверхность**: иконки рабочих пространств и файлов; фон (цвет), сетка,
  Snap to grid из контекстного меню; двойной щелчок по рабочему
  пространству открывает окно.
- **Окна**: перетаскивание за заголовок, изменение размера за края, фокус
  поднимает наверх, Minimize, Fullscreen (вкладки и панель задач скрыты),
  Close. Содержимое: фейковое рабочее пространство (боковая панель и список
  файлов), Hub (несколько карточек), пустое окно.
- **Панель задач**: Start (список рабочих пространств, открывает в новом
  окне), кнопка на каждое окно (свернуть/развернуть), крестик закрытия.
- **Cmd+N / Alt+N** — новое пустое окно.
- **Фейковые данные**: «Music» — три рабочих пространства (свой трек, общий
  с продюсером, общий с двумя людьми — сценарий «The case for keeping
  them») и два файла на доске; «Work» — одно рабочее пространство и
  открытое окно.

### Состав папки

1. `screenshots/`, `index.html` (+ `app.js`, `styles.css`).
2. `git mv DESKTOPS_EXPERIMENT.md prototypes/desktop-environment/`. В начало
   — «Status: removed from the product in v2.2.2; see README». Обновить
   ссылки: `rg DESKTOPS_EXPERIMENT` находит `store/experiments.ts` (уйдёт на
   этапе 2), `schema.sql`, `rpc.sql` (уйдут на этапах 4 и 6) и
   `PILE_ABSTRACTION.md`, если он есть.
3. `README.md`: что это было (три роли десктопа, кратко), почему убрано,
   как открыть прототип, чем он отличается от настоящей функции, ссылка на
   последний коммит с настоящей функцией — **заглушка**, её дописывает
   коммит этапа 2 (SHA его родителя).

Проверка: Claude открывает `index.html` и проходит «Что должно работать».

## Этап 2. Клиент без десктопов

Коммит(ы): «refactor: remove desktops and windows». Можно 2–3 коммита,
каждый с зелёными тестами.

### 2.1 Корень приложения

`ui/desktop/DesktopShell.vue` → `ui/app/AppShell.vue`. Оставить: UApp,
оверлей перетаскивания, `listenFolderDrop` / `listenOpenedPaths` (ветки
fullscreen), диалоги (QuotaWall, Bridge, Password, BulkRename, Summary,
AiConsent), `UpdateBanner`. Убрать: `mode`, окна, `DesktopSurface`,
`DesktopTabs`, `Taskbar`, `RemoveDesktopModal`, Cmd/Alt+N, `import_to_desktop`.

`main.ts`: монтировать `AppShell`; убрать `exit_to_fullscreen` и все
`prune_*` десктопов и окон. **`navigator.storage.persist()` оставить** — он
в той же ветке, но держит и браузерные рабочие пространства.

`UpdateBanner.vue`, `DesktopUpdateControls.vue` → `ui/app/`. В
`UpdateBanner.vue` убрать импорт `desktops` и сдвиг над панелью задач.

### 2.2 Удалить файлы

- `ui/desktop/*`, кроме перенесённых в 2.1; `ui/window/*`
- `store/desktops.ts`, `store/desktopChildren.ts`, `store/workspaceRegistry.ts`,
  `store/experiments.ts` и их тесты
- `services/cloud/desktops.ts`, `desktopBoards.ts`,
  `desktopBoardFileManager.ts`, `desktopRemoval.ts`, `systemWorkspace.ts`,
  `desktopsExperiment.ts` и их тесты
- `services/desktop/desktopFolders.ts` и тест
- `domain/Desktop.ts`
- `ui/workspace/menu/WorkspaceTileMenu.vue`, `LocalWorkspaceTileMenu.vue`
  (в `DefaultWidgetContent.vue` и `FolderPreviewWidget.vue` остаётся
  `FolderMenu`)

**Не удалять**: `services/window/WindowManager` (диалоги Tauri),
`services/ai/desktopTransport.ts`, `isDesktop.ts`, updater, `interactjs`,
`vuedraggable`, команды и capabilities в `src-tauri`.

### 2.3 Разделить `services/desktop/browserDesktopFolders.ts`

`browser_storage_available`, `browser_storage`, `require_browser_storage`,
`browser_entry_exists` → `services/workspace/browserStorage.ts` (их
используют `store/bridge.ts`, `openWorkspaceStore.ts`, `workspaces_list.ts`).
Остальное удалить. Корни браузерных десктопов в IndexedDB остаются — нужное
забрали на этапе 0.

### 2.4 Убрать ветки десктопов

- `domain/Store.ts`: `as_new_window`, `replace_window_id`,
  `eject_workspace`, `enter_desktops_mode`, `exit_desktops_mode`
- `store/index.ts`: `mode === 'desktops'`, реализации тех же методов,
  закрытие окна
- `store/cloud.ts`: `sync_cloud_desktops`, `teardown_cloud_desktops`,
  `mark_desktops_opt_in`, `load_for_window`, `open_public_for_window`,
  `reset_system_workspace_cache()` при выходе, ветки `desktops.mode`,
  два фильтра `.eq('is_system', false)` в `fetch_workspaces` и `is_system`
  в типах клиента, если есть
- `services/publicRoute.ts`: поле `mode`, `window_content_from_fullscreen`,
  `WindowContent`; в `publicRoute.test.ts` удалить `describe` этой функции,
  тесты обычных маршрутов оставить
- `services/navigatePublic.ts`: `open_public_window`,
  `has_fullscreen_window`, ветки режимов; тесты обновить
- `ui/workspace/WorkspaceWindow.vue`: `window_context`, кнопки окна;
  `storage-key` панелей — постоянный `'workspace'`
- `ui/hub/HubCard.vue`, `ui/hub/AuthorCard.vue`
- `WorkspacesList.vue`, `WorkspacesPopover.vue`: режим `new-window`,
  открытие Hub в окне
- `useFolderContainerScope.ts`: `fixedView`, `backgroundOverride`,
  `workspaceTileAt`, `localTileAt`, `menuSections`; их ветки в `Board.vue`
  (прозрачный фон, Backspace — в обычном рабочем пространстве его уже
  обрабатывает chrome папки), `FolderMenu.vue`, `useFolderViewMenuItems.ts`,
  `useFolderContainerMenuItems.ts`
- `SettingsPanel.vue`: секция Experimental целиком
- `localStorage.removeItem('desktops_state')` и
  `('pile_commander_experimental_desktops')` один раз при старте — можно в
  этой версии, раз `useStorage` этих ключей в ней уже нет

### 2.5 Проверка

```bash
rg -i "desktops?_|desktop_children|workspace_registry|window_context|enter_desktops|DesktopShell|\bTaskbar\b|open_public_for_window|window_content_from_fullscreen|TileMenu|fixedView|system_workspace" apps/client/src
rg -n "is_system" apps/client/src
```

Первая команда — только updater и `isDesktop`. Вторая — пусто.

- `bun run test` из корня
- `cd apps/client && node_modules/.bin/vue-tsc --noEmit`
- вручную: старт, локальное и облачное рабочее пространство, Hub и профиль
  автора открываются и закрываются, `/<user>/<slug>` открывается, в Settings
  нет Experimental, перетаскивание файла из Finder в десктопной сборке,
  баннер обновления на месте
- в README прототипа заменить заглушку на SHA родителя первого коммита
  этапа 2

### 2.6 Релиз

Владелец выпускает десктопное приложение (`bun run version:desktop`,
`build:desktop`), оба пользователя обновляются. Отложено до общего
релиза v2.2.2; этап 4 сделан раньше (см. «Этап 4 до релиза»).

## Этап 3. Лендинг и документы

Коммит: «docs: drop desktops from the landing and docs». Тексты — только
точечно и показать владельцу до коммита: глобальная замена испортит
«desktop app».

- Убрать `HomeDesks` из `pages/index.vue` и `components/home/Desks.vue`.
- `WhereItLives.vue`, `AnyDevice.vue`: рядом оба смысла. «Cloud desktops
  follow you» — функция, переписать; «a desktop, a tablet and a phone» —
  устройство, не трогать.
- `UnderTheHood.vue` («The browser version keeps its desktops in
  IndexedDB»), `FilesStayFiles.vue` («a demo and browser desktops»).
- **Не трогать**: `pages/vision.vue`, `components/vision/Desktop.vue`
  (отдельная идея десктопа для Linux), `desktop-release`, страницу
  загрузки, фразы про приложение для macOS, Windows и Linux.
- `README.md`, `AGENTS.md`: только десктопы как функция.
- `terms.vue`, `support.vue`, `pricing.vue`, `privacy.vue` и `SECURITY.md` —
  на этапе 4, вместе с удалением данных.

## Этап 4. Diff `drop-desktops.sql`

Гейт: бэкап базы. Коммит «db: drop desktops»: diff, `schema.sql` и
`rpc.sql` в конечном состоянии (без десктопов и без `is_system`),
`rls.test.sql`, `postgres.test.ts`, `SECURITY.md`, юридические страницы
лендинга (`terms`, `support`, `pricing`, `privacy`).

### Порядок внутри diff'а

`on delete cascade` срабатывает при удалении строк, не при `drop table`.
`drop table public.desktops` без `cascade` не выполнится из-за ключа
`workspaces.desktop_id`. Обнуление всё равно первым — оно защищает от
`delete` строк десктопов.

0. Предохранитель: если системные рабочие пространства появились после
   подсчёта этапа 0, diff останавливается, ничего не меняя:

   ```sql
   do $$ begin
     if exists (select 1 from public.workspaces where is_system) then
       raise exception 'system workspaces exist: review them first';
     end if;
   end $$;
   ```

1. `update public.workspaces set desktop_id = null where desktop_id is not null;`
2. Политики `workspaces_insert` и `workspaces_delete` — `drop policy` и
   `create policy` без `is_system` (`create or replace` для политик нет).
   `drop index workspaces_system_unique;`
3. Функции, которые знают про десктопы или `is_system`, — заменить до
   удаления колонок (тела на plpgsql не держат зависимость: колонка
   удалится, а функция упадёт при вызове, например `handle_new_user` — на
   регистрации). Список: `private.plan_defaults` (меняет `returns table` —
   сначала `drop function private.plan_defaults(text)`, потом `create`),
   `private.claim_workspace_invites` (оба варианта, в `schema.sql` и
   `rpc.sql`), `private.set_workspace_public`,
   `private.add_workspace_member`, `handle_new_user` и всё, что найдёт
   `rg -n "desktop|is_system" packages/file-manager/src/*.sql`.
4. `create_workspace` без `p_desktop`: `drop function` старой сигнатуры —
   публичные обёртки раньше приватных (`public.create_workspace` на SQL
   реально зависит от `private.*`), затем `create` новой.
5. `drop function`: `public.get_or_create_system_workspace` и приватная,
   `desktops_touch`, `desktops_count_guard`, `is_desktop_owner`,
   `assert_owner_desktops`, `mark_desktops_opt_in`,
   `desktops_experiment_report`.
6. `alter table public.workspaces drop column desktop_id;`
   `drop table public.desktops;` `drop table private.desktops_opt_ins;`
7. `alter table public.workspaces drop column is_system;`
8. `alter table public.billing_accounts drop column max_desktops;`

### Конечные файлы

- В `schema.sql` не остаётся `grant … on public.desktops`, политик,
  триггеров, индексов `desktops_owner_idx` и `workspaces_system_unique`,
  колонки `is_system`.
- `insert` в `billing_accounts` в конце `schema.sql` — только для пустой
  тестовой базы, в diff не копировать.
- `rls.test.sql`: убрать вызовы `create_workspace(..., null)`, кейс
  `max_desktops`, проверки `mark_desktops_opt_in`,
  `desktops_experiment_report` и системного рабочего пространства — иначе
  `test:rls:remote` упадёт сразу после применения.

### Проверка и применение

1. `postgres.test.ts` локально — доказывает конечную схему, не diff.
2. Репетиция diff'а: восстановить бэкап в `pile_security_test`, применить
   `drop-desktops.sql` через `psql`. Проверить: число рабочих пространств
   не изменилось (на 2026-10-26 их 5, все у владельца, два опубликованы:
   «Pile Commander Features» и «Pile Commander Use cases»); `select public.create_workspace('x')` работает;
   регистрация нового пользователя (`handle_new_user`) не падает.
   **Не запускать `postgres.test.ts` после репетиции на той же базе** — он
   её пересоздаёт; если нужен, то до восстановления дампа.
3. Применить к production (владелец: `apply_migration` или SQL editor).
4. `bun --filter @pile-commander/file-manager test:rls:remote`, `get_advisors`.
5. Клиент из ветки `v2.2.2` (`bun run dev:web`) под аккаунтом владельца:
   список облачных рабочих пространств на месте, новое создаётся и
   удаляется. Текущий сайт без входа: Hub и `/<user>/<slug>` открываются.

## Что остаётся после задачи

- Папки `~/Pile Commander/desktops/*` на дисках пользователей — их файлы.
- Корни браузерных десктопов в IndexedDB — без интерфейса, место
  освободится, если пользователь очистит данные сайта.
