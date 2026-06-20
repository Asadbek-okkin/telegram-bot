/* Mustaqil, doimiy ishlaydigan Telegram bot: pack-master yoki boshqa biror loyihaga bog'liq
emas. Tugma bosilganda DARROV javob beradi (long-polling, getUpdates). */
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TOKEN = process.env.PM_TELEGRAM_BOT_TOKEN;
const CHAT_ID = '313364362';
const OFFSET_FILE = path.join(os.homedir(), '.claude', 'pm-telegram-offset.txt');
const IDEAS_FILE = path.join(__dirname, 'data', 'ideas.json');

function apiCall(method, params) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(params);
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${TOKEN}/${method}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function sendMessage(text) {
  return apiCall('sendMessage', { chat_id: CHAT_ID, text }).catch((e) => console.error('Telegram send error:', e.message));
}

function getOffset() {
  try {
    const raw = fs.readFileSync(OFFSET_FILE, 'utf8').trim();
    const n = parseInt(raw, 10);
    return isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function setOffset(n) {
  try {
    fs.mkdirSync(path.dirname(OFFSET_FILE), { recursive: true });
    fs.writeFileSync(OFFSET_FILE, String(n));
  } catch (e) {
    console.error('offset write error', e.message);
  }
}

function getUpdates(offset) {
  return new Promise((resolve, reject) => {
    https
      .get(`https://api.telegram.org/bot${TOKEN}/getUpdates?offset=${offset}&timeout=25`, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      })
      .on('error', reject);
  });
}

function statusReport() {
  const uptimeSec = os.uptime();
  const h = Math.floor(uptimeSec / 3600);
  const m = Math.floor((uptimeSec % 3600) / 60);
  return `Kompyuter: ${os.hostname()}\nIshlab turgan vaqt: ${h} soat ${m} daqiqa\nHozirgi vaqt: ${new Date().toLocaleString('uz-UZ')}`;
}

function appendIdea(text) {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(IDEAS_FILE, 'utf8')); } catch {}
  list.push({ text, at: new Date().toISOString() });
  fs.mkdirSync(path.dirname(IDEAS_FILE), { recursive: true });
  fs.writeFileSync(IDEAS_FILE, JSON.stringify(list, null, 2));
}

function ideasArchiveReport() {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(IDEAS_FILE, 'utf8')); } catch {}
  if (!list.length) return "Hali hech qanday g'oya yozilmagan.";
  const MAX_SHOWN = 30;
  const shown = list.length > MAX_SHOWN ? list.slice(-MAX_SHOWN) : list;
  const skippedTxt = list.length > MAX_SHOWN ? ` (oxirgi ${MAX_SHOWN} tasi, jami ${list.length})` : '';
  const lines = shown.map((idea, i) => {
    const date = new Date(idea.at).toLocaleString('uz-UZ');
    const mark = idea.seen ? '✓' : '•';
    return `${mark} ${i + 1}. [${date}] ${idea.text}`;
  });
  return `G'oyalar ombori${skippedTxt} (✓ = Claude Code ko'rib chiqgan):\n` + lines.join('\n');
}

async function handleText(text) {
  console.log(`[telegram] received: ${text}`);
  switch (text) {
    case '📊 Holat':
      await sendMessage(`[Holat]\n${statusReport()}`);
      return;
    case "💡 G'oya yozaman":
      await sendMessage("Mayli, g'oyangizni yozing - keyingi xabaringiz saqlanadi.");
      return;
    case "📋 G'oyalar ombori":
      await sendMessage(ideasArchiveReport());
      return;
    case '/start':
      await sendMessage('Bot tayyor! Pastdagi tugmalardan foydalaning.');
      return;
    default:
      appendIdea(text);
      await sendMessage(`Qabul qilindi va saqlandi: "${text}"`);
  }
}

async function pollLoop() {
  if (!TOKEN) {
    console.log('Telegram bot: PM_TELEGRAM_BOT_TOKEN topilmadi - bot ochirilgan.');
    return;
  }
  console.log('Telegram bot: tinglash boshlandi (darrov javob beradi).');
  let offset = getOffset();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const resp = await getUpdates(offset);
      if (resp && resp.ok && resp.result) {
        for (const update of resp.result) {
          offset = Math.max(offset, update.update_id + 1);
          if (update.message && String(update.message.chat.id) === CHAT_ID && update.message.text) {
            await handleText(update.message.text);
          }
        }
        setOffset(offset);
      }
    } catch (e) {
      console.error('Telegram poll error:', e.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

if (require.main === module) {
  pollLoop();
}

module.exports = { pollLoop };
