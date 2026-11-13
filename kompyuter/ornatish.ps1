# Kompyuter agentini o'rnatish (bir marta, administrator sifatida).
#  - agent.py ni C:\ProgramData\KompyuterAgent ga ko'chiradi, maxfiy kalit yaratadi (bo'lmasa)
#  - "KompyuterAgent" vazifasi: Windows yoqilishi bilan SYSTEM nomidan ishga tushadi (hech kim kirmasa ham)
#  - agent o'zi https://inok.uz/claude-pc/ ga ulanib turadi (kompyuterga tashqaridan kirilmaydi)
#  - Tezkor ishga tushirishni (Fast Startup) o'chiradi: BIOS taymeri / Wake-on-LAN ishonchli ishlashi uchun
# Ishlatish: o'ng tugma -> "Run with PowerShell" (o'zi administrator huquqini so'raydi)
$ErrorActionPreference = 'Stop'
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit
}

$papka = 'C:\ProgramData\KompyuterAgent'
New-Item -ItemType Directory -Force $papka | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'agent.py') $papka -Force

$kalitFayl = Join-Path $papka 'kalit.txt'
if (-not (Test-Path $kalitFayl)) {
    $b = New-Object byte[] 24; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    [IO.File]::WriteAllText($kalitFayl, (($b | ForEach-Object { $_.ToString('x2') }) -join ''))
}

$py = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source
if (-not $py) { $py = Join-Path (Split-Path (Get-Command python.exe).Source) 'pythonw.exe' }

$action = New-ScheduledTaskAction -Execute $py -Argument "`"$papka\agent.py`"" -WorkingDirectory $papka
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName 'KompyuterAgent' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

# eski (foydalanuvchi nomidan ishlayotgan) nusxa bo'lsa to'xtatamiz, keyin SYSTEM vazifasini yoqamiz
Get-CimInstance Win32_Process -Filter "Name like 'python%'" | Where-Object { $_.CommandLine -like '*agent.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-ScheduledTask -TaskName 'KompyuterAgent'

# Fast Startup o'chiriladi (to'liq o'chish - BIOS "Power On by RTC" va Wake-on-LAN uchun)
Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -Name HiberbootEnabled -Value 0

Start-Sleep 3
Write-Host ''
Write-Host "Tayyor. Agent: $papka (vazifa: KompyuterAgent)" -ForegroundColor Green
Write-Host "Kalit: $kalitFayl - u Hetzner'dagi /etc/claude-asadbek-bot.env PC_KALIT bilan bir xil bo'lishi kerak."
Write-Host ''
Read-Host 'Yopish uchun Enter'
