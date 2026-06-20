# SessionStart hook: pulls new messages sent to the Telegram bot since the last time any
# Claude Code session (in any project) checked, and surfaces them as context. This is a
# fallback for when bot.js's long-poll loop isn't running on this machine - when it IS
# running, it answers instantly itself and free-text notes land in data/ideas.json, which
# this hook also reads and marks as seen so Claude becomes aware of them at session start.
#
# Requires $env:PM_TELEGRAM_BOT_TOKEN to be set on this machine (not committed to the repo).
# Offset state is stored outside any repo at %USERPROFILE%\.claude\pm-telegram-offset.txt.

$ErrorActionPreference = 'SilentlyContinue'

$token = $env:PM_TELEGRAM_BOT_TOKEN
if ([string]::IsNullOrWhiteSpace($token)) { exit 0 }

$chatId = '313364362'
$botDir = Split-Path -Parent $PSScriptRoot
$stateDir = Join-Path $env:USERPROFILE '.claude'
$stateFile = Join-Path $stateDir 'pm-telegram-offset.txt'
if (-not (Test-Path $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }

$offset = 0
if (Test-Path $stateFile) {
  $raw = Get-Content $stateFile -Raw
  if ($raw) {
    $parsed = 0
    if ([int]::TryParse($raw.Trim(), [ref]$parsed)) { $offset = $parsed }
  }
}

# Eslatma: agar shu kompyuterda doimiy bot (bot.js) ishlab tursa, u Telegram bilan
# UZLUKSIZ long-polling qiladi - shu vaqtda BIZ HAM getUpdates chaqirsak, Telegram odatda
# 409 (Conflict) xato qaytaradi. Shu sababli bu yerdagi xato HECH QACHON butun skriptni
# to'xtatmasligi kerak - faqat $texts bo'sh qoladi, pastdagi ideas.json tekshiruvi
# (bot qoldirgan yozuvlar) baribir davom etadi.
$texts = @()
try {
  $uri = "https://api.telegram.org/bot$token/getUpdates?offset=$offset&timeout=0"
  $resp = Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec 8
  if ($resp -and $resp.ok -and $resp.result) {
    $maxUpdateId = $offset - 1
    foreach ($update in $resp.result) {
      if ($update.update_id -gt $maxUpdateId) { $maxUpdateId = $update.update_id }
      if ($update.message -and "$($update.message.chat.id)" -eq $chatId -and $update.message.text) {
        $texts += $update.message.text
      }
    }
    Set-Content -Path $stateFile -Value ([string]($maxUpdateId + 1)) -NoNewline -Force
  }
} catch {
  # Doimiy bot bilan to'qnashgan yoki tarmoq xatosi - jim o'tib ketamiz, pastga davom etamiz.
}

$ideaTexts = @()
$ideasFile = Join-Path $botDir 'data\ideas.json'
if (Test-Path $ideasFile) {
  try {
    $ideasRaw = Get-Content $ideasFile -Raw
    $ideasParsed = ConvertFrom-Json $ideasRaw
    $allIdeas = @($ideasParsed)
    $changed = $false
    foreach ($idea in $allIdeas) {
      if (-not $idea.seen) {
        $ideaTexts += $idea.text
        $idea | Add-Member -NotePropertyName seen -NotePropertyValue $true -Force
        $changed = $true
      }
    }
    if ($changed) { ($allIdeas | ConvertTo-Json -Depth 5) | Set-Content -Path $ideasFile -Force }
  } catch {}
}

# Bot ishlamayotgan bo'lsa, shu yerda to'g'ridan-to'g'ri olingan free-text xabarlar ham
# "g'oya" sifatida hisoblanadi (tugma matnlari bo'lmagan har qanday matn).
$knownButtons = @('📊 Holat', "💡 G'oya yozaman", "📋 G'oyalar ombori", '/start')
foreach ($t in $texts) {
  if ($knownButtons -notcontains $t) { $ideaTexts += $t }
}

if ($ideaTexts.Count -eq 0) { exit 0 }

$body = "Telegram bot orqali kelgan g'oyalar/eslatmalar (oxirgi sessiyadan beri):`n`n" + (($ideaTexts | ForEach-Object { "- $_" }) -join "`n")
$result = @{ hookSpecificOutput = @{ hookEventName = 'SessionStart'; additionalContext = $body } }
$result | ConvertTo-Json -Depth 5 -Compress
exit 0
