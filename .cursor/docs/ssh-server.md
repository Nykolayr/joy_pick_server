# SSH на прод-сервер (PowerShell)

```powershell
ssh -i $env:USERPROFILE\.ssh\id_ed25519 root@45.84.225.22
```

Ключ: `%USERPROFILE%\.ssh\id_ed25519`, пользователь `root`, хост `45.84.225.22`.

## Деплой бэкенда (копия файлов + PM2)

Каталог на сервере: `/opt/joypick`. После `scp` перезапуск с подтягиванием переменных окружения из конфигурации PM2:

```powershell
$key = "$env:USERPROFILE\.ssh\id_ed25519"
$srv = "root@45.84.225.22"
Set-Location "D:\Projects\joy_pick\joy_pick_server"

scp -i $key api/services/supportAiService.js "${srv}:/opt/joypick/api/services/supportAiService.js"
# …другие изменённые файлы по тем же путям…

ssh -i $key $srv "cd /opt/joypick && pm2 restart joypick --update-env"
```

В PowerShell не используйте имя переменной `$Host` для SSH-хоста — это встроенная переменная. Берите, например, `$srv`.
