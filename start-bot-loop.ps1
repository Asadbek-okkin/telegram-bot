# Botni ishga tushiradi va agar u to'xtab qolsa (yiqilib qolsa), bir necha soniyadan keyin
# avtomatik qayta ishga tushiradi. Windows "Startup" papkasidagi yorliq orqali kompyuterga
# kirilganda avtomatik chaqiriladi - shu orqali bot doim ishlab turadi.

$ErrorActionPreference = 'SilentlyContinue'
$botDir = $PSScriptRoot
$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if ($nodeCmd) {
  $nodeExe = $nodeCmd.Source
} elseif (Test-Path 'C:\Program Files\nodejs\node.exe') {
  $nodeExe = 'C:\Program Files\nodejs\node.exe'
} else {
  $nodeExe = 'node.exe'
}
$logFile = Join-Path $botDir 'data\bot.log'
New-Item -ItemType Directory -Path (Join-Path $botDir 'data') -Force | Out-Null

[Environment]::SetEnvironmentVariable('PM_TELEGRAM_BOT_TOKEN', [Environment]::GetEnvironmentVariable('PM_TELEGRAM_BOT_TOKEN', 'User'), 'Process')
[Environment]::SetEnvironmentVariable('PM_GROQ_API_KEY', [Environment]::GetEnvironmentVariable('PM_GROQ_API_KEY', 'User'), 'Process')
[Environment]::SetEnvironmentVariable('PM_KANAL', [Environment]::GetEnvironmentVariable('PM_KANAL', 'User'), 'Process')

while ($true) {
  "[$(Get-Date)] Bot ishga tushirilmoqda..." | Out-File -FilePath $logFile -Append -Encoding utf8
  Start-Process -FilePath $nodeExe -ArgumentList 'bot.js' -WorkingDirectory $botDir -NoNewWindow -Wait -RedirectStandardOutput "$logFile.out" -RedirectStandardError "$logFile.err"
  "[$(Get-Date)] Bot to'xtadi, 5 soniyadan keyin qayta ishga tushadi." | Out-File -FilePath $logFile -Append -Encoding utf8
  Start-Sleep -Seconds 5
}
