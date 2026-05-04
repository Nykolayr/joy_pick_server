# SSH на прод-сервер (PowerShell)

## Порядок: сначала Git, потом прод

1. **Локально:** `git add` → `git commit` → **`git push`** в удалённый репозиторий. Сначала фиксируем изменения в Git (история, бэкап логики, ревью).
2. **Прод:** на сервере **`/opt/joypick` — только файлы и папки, Git-репозитория там нет.** Копируем актуальные файлы с машины разработчика через **`scp`** (те же пути относительно корня проекта).
3. **Рестарт:** по SSH выполнить **`pm2 restart joypick --update-env`**, чтобы процесс подхватил новые файлы и env из конфига PM2.

Не наоборот: не заливать на сервер «сырые» правки без коммита в Git, если это не согласованное исключение.

```powershell
ssh -i $env:USERPROFILE\.ssh\id_ed25519 root@45.84.225.22
```

Ключ: `%USERPROFILE%\.ssh\id_ed25519`, пользователь `root`, хост `45.84.225.22`.

## Шаги 2–3: `scp` на сервер + PM2

```powershell
$key = "$env:USERPROFILE\.ssh\id_ed25519"
$srv = "root@45.84.225.22"
Set-Location "D:\Projects\joy_pick\joy_pick_server"

scp -i $key api/services/supportAiService.js "${srv}:/opt/joypick/api/services/supportAiService.js"
scp -i $key docs/joy_pick_app_master_flows.md "${srv}:/opt/joypick/docs/joy_pick_app_master_flows.md"
scp -i $key docs/knowledge/support_en/chunks.json "${srv}:/opt/joypick/docs/knowledge/support_en/chunks.json"
scp -i $key docs/knowledge/support_ru/chunks.json "${srv}:/opt/joypick/docs/knowledge/support_ru/chunks.json"
scp -i $key package.json "${srv}:/opt/joypick/package.json"
scp -i $key scripts/run_support_eval_direct.js "${srv}:/opt/joypick/scripts/run_support_eval_direct.js"
scp -i $key scripts/run_support_eval_openrouter_first.js "${srv}:/opt/joypick/scripts/run_support_eval_openrouter_first.js"
scp -i $key scripts/run_support_rag_stress.js "${srv}:/opt/joypick/scripts/run_support_rag_stress.js"
scp -i $key scripts/support_eval_cases.json "${srv}:/opt/joypick/scripts/support_eval_cases.json"

ssh -i $key $srv "cd /opt/joypick && pm2 restart joypick --update-env"
```

Список `scp` подставь под **фактически изменённые** файлы в коммите. Папки на сервере должны существовать (например `docs/knowledge/support_en`); при необходимости один раз создать: `ssh ... "mkdir -p /opt/joypick/docs/knowledge/support_en ..."`.

В PowerShell не используйте имя переменной `$Host` для SSH-хоста — это встроенная переменная. Берите, например, `$srv`.
