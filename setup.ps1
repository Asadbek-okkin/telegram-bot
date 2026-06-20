# Bu skript Telegram botni YANGI kompyuterda birinchi marta sozlaydi: tokenni saqlaydi,
# Windows ishga tushganda bot avtomatik boshlanadigan qilib qo'yadi va botni hozir ham
# ishga tushiradi.
# Ishlatish: shu papkada -> powershell -ExecutionPolicy Bypass -File setup.ps1 -Token "<BOT_TOKEN>"
param(
  [string]$Token = $env:PM_TELEGRAM_BOT_TOKEN
)

$ErrorActionPreference = 'Stop'
$botDir = $PSScriptRoot

$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCmd -and -not (Test-Path 'C:\Program Files\nodejs\node.exe')) {
  Write-Host "XATO: Node.js topilmadi. Avval https://nodejs.org saytidan (LTS versiya) o'rnating, keyin shu skriptni qaytadan ishga tushiring." -ForegroundColor Red
  exit 1
}

if (-not $Token) {
  Write-Host "XATO: Telegram bot tokeni berilmagan. Ishlatish: .\setup.ps1 -Token `"<BOT_TOKEN>`"" -ForegroundColor Red
  exit 1
}
[Environment]::SetEnvironmentVariable('PM_TELEGRAM_BOT_TOKEN', $Token, 'User')
$env:PM_TELEGRAM_BOT_TOKEN = $Token

New-Item -ItemType Directory -Path (Join-Path $botDir 'data') -Force | Out-Null

$startupDir = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupDir 'TelegramBot.lnk'
$loopScript = Join-Path $botDir 'start-bot-loop.ps1'
$wshell = New-Object -ComObject WScript.Shell
$shortcut = $wshell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = 'powershell.exe'
$shortcut.Arguments = "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$loopScript`""
$shortcut.WorkingDirectory = $botDir
$shortcut.WindowStyle = 7
$shortcut.Save()

Write-Host "Yorliq yaratildi: $shortcutPath" -ForegroundColor Green
Write-Host "Kompyuter har safar yonganda bot avtomatik ishga tushadi."

Start-Process -FilePath 'powershell.exe' -ArgumentList "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$loopScript`"" -WorkingDirectory $botDir

Start-Sleep -Seconds 2
Write-Host "Sozlash tugadi. Telegram botdagi tugmalardan birini bosib tekshiring." -ForegroundColor Cyan
