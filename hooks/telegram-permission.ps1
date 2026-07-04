# PermissionRequest hook: kompyuter oldida bo'lmaganda ruxsat so'rovlariga telefondan
# Telegram orqali javob berish imkonini beradi. Pending ruxsat haqida bot orqali xabar
# yuboriladi, so'ng cheklangan vaqt ichida "ha"/"yo'q" javobi kutiladi. Loyihadan mustaqil -
# istalgan Claude Code loyihasida ishlaydi (global ~/.claude/settings.json orqali ulanadi).
#
# XAVFSIZLIK: agar token yo'q, javob kelmasa, vaqt tugasa yoki xato chiqsa - hech qanday
# JSON chiqarilmaydi va skript 0 bilan tugaydi. Bu holatda Claude Code ODDIY ekrandagi
# ruxsat so'rovini ko'rsatadi (hech qachon avtomatik ruxsat BERMAYDI - rasmiy hujjatga
# ko'ra muvaffaqiyatsizlik doim "oddiy so'rovga qaytish" bilan tugaydi).
#
# O'CHIRISH: $env:PM_TELEGRAM_APPROVAL_ENABLED ni "0" ga o'rnatish shu hookni butunlay
# o'chiradi (masalan kompyuter oldida bo'lib, kechikishni xohlamasangiz).
#
# Requires $env:PM_TELEGRAM_BOT_TOKEN (boshqa hooklar bilan bir xil, repo'ga yozilmagan).

$ErrorActionPreference = 'SilentlyContinue'

if ($env:PM_TELEGRAM_APPROVAL_ENABLED -eq '0') { exit 0 }

$token = $env:PM_TELEGRAM_BOT_TOKEN
if ([string]::IsNullOrWhiteSpace($token)) { exit 0 }

$chatId = '313364362'
$waitSeconds = 90
$pollIntervalSeconds = 3

$stdin = [Console]::In.ReadToEnd()
$reqJson = $null
try { $reqJson = $stdin | ConvertFrom-Json } catch { exit 0 }
if (-not $reqJson) { exit 0 }

$toolName = "$($reqJson.tool_name)"
$toolInputStr = ''
try { $toolInputStr = ($reqJson.tool_input | ConvertTo-Json -Compress -Depth 5) } catch { $toolInputStr = '' }
if ($toolInputStr.Length -gt 280) { $toolInputStr = $toolInputStr.Substring(0, 280) + '...' }

$projectName = if ($env:CLAUDE_PROJECT_DIR) { Split-Path -Leaf $env:CLAUDE_PROJECT_DIR } else { 'noma''lum loyiha' }

$stateDir = Join-Path $env:USERPROFILE '.claude'
$offsetFile = Join-Path $stateDir 'pm-telegram-offset.txt'
if (-not (Test-Path $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }

function Get-StoredOffset {
  $offset = 0
  if (Test-Path $offsetFile) {
    $raw = Get-Content $offsetFile -Raw
    if ($raw) { $p = 0; if ([int]::TryParse($raw.Trim(), [ref]$p)) { $offset = $p } }
  }
  return $offset
}

# --- IDLE GATE ---
# Foydalanuvchi hozir kompyuter oldida FAOL bo'lsa (oxirgi harakatdan $idleThresholdMin
# daqiqadan kam vaqt o'tgan), Telegram'ni butunlay o'tkazib yuboramiz va exit 0 qilamiz -
# Claude Code darhol VS'da oddiy ruxsat tugmalarini ko'rsatadi (telefon bezovta qilinmaydi).
# Faqat foydalanuvchi 30+ daqiqa harakatsiz (kompyuter oldida bo'lmasa) Telegram'ga yuboriladi.
# Ostonani o'zgartirish: $env:PM_TELEGRAM_IDLE_MIN (masalan "15").
$idleThresholdMin = 30
if ($env:PM_TELEGRAM_IDLE_MIN) { $tmpMin = 0; if ([int]::TryParse($env:PM_TELEGRAM_IDLE_MIN, [ref]$tmpMin)) { $idleThresholdMin = $tmpMin } }
try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace Inok {
  public static class IdleHelper {
    [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
    [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
    public static uint IdleMs() {
      LASTINPUTINFO l = new LASTINPUTINFO();
      l.cbSize = (uint)Marshal.SizeOf(l);
      GetLastInputInfo(ref l);
      return ((uint)Environment.TickCount - l.dwTime);
    }
  }
}
'@ -ErrorAction SilentlyContinue
  $idleMin = [Inok.IdleHelper]::IdleMs() / 60000.0
  if ($idleMin -lt $idleThresholdMin) { exit 0 }
} catch {
  # Idle aniqlab bo'lmasa, xavfsiz standart: eski xatti-harakat (Telegram'ga yuborishda davom etamiz).
}

$msgText = "RUXSAT SO'RALMOQDA ($projectName)`nAsbob: $toolName`n$toolInputStr`n`nJavob: HA (ruxsat) yoki YO'Q (rad) deb yozing. $waitSeconds soniya ichida javob bo'lmasa, kompyuterda oddiy so'rov ko'rinadi."
try {
  $sendBody = @{ chat_id = $chatId; text = $msgText } | ConvertTo-Json
  Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/sendMessage" -Method Post -Body ([System.Text.Encoding]::UTF8.GetBytes($sendBody)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 8 | Out-Null
} catch {
  exit 0
}

$decision = $null
$deadline = (Get-Date).AddSeconds($waitSeconds)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds $pollIntervalSeconds
  $offset = Get-StoredOffset
  $resp = $null
  try {
    $resp = Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/getUpdates?offset=$offset&timeout=0" -Method Get -TimeoutSec 5
  } catch { continue }
  if (-not $resp -or -not $resp.ok -or -not $resp.result) { continue }

  $maxId = $offset - 1
  foreach ($u in $resp.result) {
    if ($u.update_id -gt $maxId) { $maxId = $u.update_id }
    if ($u.message -and "$($u.message.chat.id)" -eq $chatId -and $u.message.text) {
      $t = $u.message.text.Trim().ToLowerInvariant()
      if (-not $decision -and ($t -eq 'ha' -or $t -eq 'yes' -or $t -eq '✅' -or $t -eq 'tasdiqlayman')) { $decision = 'allow' }
      elseif (-not $decision -and ($t -eq "yo'q" -or $t -eq 'yoq' -or $t -eq 'no' -or $t -eq '❌' -or $t -eq 'rad')) { $decision = 'deny' }
    }
  }
  if ($maxId -ge $offset) { Set-Content -Path $offsetFile -Value ([string]($maxId + 1)) -NoNewline -Force }
  if ($decision) { break }
}

if (-not $decision) { exit 0 }

try {
  $ackText = if ($decision -eq 'allow') { "Qabul qilindi: RUXSAT BERILDI ($toolName)" } else { "Qabul qilindi: RAD ETILDI ($toolName)" }
  $ackBody = @{ chat_id = $chatId; text = $ackText } | ConvertTo-Json
  Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/sendMessage" -Method Post -Body ([System.Text.Encoding]::UTF8.GetBytes($ackBody)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 8 | Out-Null
} catch {}

$result = @{
  hookSpecificOutput = @{
    hookEventName = 'PermissionRequest'
    decision = @{ behavior = $decision }
    permissionDecisionReason = 'Telegram bot orqali javob berildi'
  }
}
$result | ConvertTo-Json -Depth 6 -Compress
exit 0
