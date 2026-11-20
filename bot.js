/* Mustaqil, doimiy ishlaydigan Telegram bot: pack-master yoki boshqa biror loyihaga bog'liq
emas. Tugma bosilganda DARROV javob beradi (long-polling, getUpdates). Holat/g'oyalar
arxivi shu faylda; mebel-kanal boshqaruvi (post, autoposting, kalit so'z, guruh) - moderator.js. */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const tg = require('./telegram-api');
const moderator = require('./moderator');
const kompyuter = require('./kompyuter');
const claudeSavol = require('./claude-savol');
const claude = require('./claude-api');
const gemini = require('./gemini-api');
const bazisShifr = require('./bazis-shifr');

const CHAT_ID = '313364362';
const OFFSET_FILE = path.join(os.homedir(), '.claude', 'pm-telegram-offset.txt');
const IDEAS_FILE = path.join(__dirname, 'data', 'ideas.json');

// Gemini kaliti bo'lsa o'sha ishlatiladi (bepul), aks holda Claude (agar balans/kalit bo'lsa).
const aiProvider = gemini.API_KEY ? gemini : claude;

const AI_SYSTEM_PROMPT = "Sen Asadbekning shaxsiy AI yordamchisisan - shu Telegram bot orqali suhbatlashasan. "
  + "Foydalanuvchi qaysi tilda yozsa (o'zbek, rus yoki ingliz), o'sha tilda javob ber. "
  + "Aniq, foydali va samimiy javob ber, keraksiz cho'zib o'tirma. "
  + "Bu Telegram matn xabari - Markdown belgilaridan (**, *, #, backtick, ```) foydalanma, faqat oddiy matn yoz.";
const HISTORY_MAX = 20; // oxirgi shuncha xabar (user+assistant) xotirada saqlanadi
let conversation = [];
let awaitingIdea = false;

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

function mainKeyboard() {
  return {
    keyboard: [
      ['📊 Holat', "💡 G'oya yozaman"],
      ...kompyuter.KEYBOARD_ROWS,
      ["📋 G'oyalar ombori", '🔄 Botni yangilash'],
      ...moderator.KEYBOARD_ROWS,
    ],
    resize_keyboard: true,
  };
}

async function handleSelfUpdate() {
  await tg.sendMessage(CHAT_ID, "Yangilanish tekshirilmoqda (git pull)...");
  try {
    const output = execSync('git pull', { cwd: __dirname, encoding: 'utf8' });
    if (/Already up to date/i.test(output)) {
      await tg.sendMessage(CHAT_ID, `Yangilanish yo'q, bot allaqachon so'nggi versiyada.\n\n${output.trim()}`);
      return;
    }
    await tg.sendMessage(CHAT_ID, `Yangilandi:\n${output.trim()}\n\nBot qayta ishga tushmoqda...`);
    process.exit(0); // start-bot-loop.ps1 avtomatik qayta ishga tushiradi
  } catch (e) {
    await tg.sendMessage(CHAT_ID, `Yangilashda xato:\n${e.message}`);
  }
}

async function handleAiChat(text) {
  conversation.push({ role: 'user', content: text });
  if (conversation.length > HISTORY_MAX) conversation = conversation.slice(-HISTORY_MAX);
  try {
    const reply = await aiProvider.chat(conversation, AI_SYSTEM_PROMPT);
    conversation.push({ role: 'assistant', content: reply });
    if (conversation.length > HISTORY_MAX) conversation = conversation.slice(-HISTORY_MAX);
    await tg.sendMessage(CHAT_ID, reply);
  } catch (e) {
    console.error('Claude chat error:', e.message);
    await tg.sendMessage(CHAT_ID, "Kechirasiz, hozir AI bilan bog'lanib bo'lmadi. Birozdan keyin qayta urinib ko'ring.");
  }
}

async function handleText(text) {
  console.log(`[telegram] received: ${text}`);
  if (await kompyuter.handleText(CHAT_ID, text)) return;
  if (await moderator.handleText(text)) return;
  switch (text) {
    case '📊 Holat':
      await tg.sendMessage(CHAT_ID, `[Holat]\n${statusReport()}`);
      return;
    case "💡 G'oya yozaman":
      awaitingIdea = true;
      await tg.sendMessage(CHAT_ID, "Mayli, g'oyangizni yozing - keyingi xabaringiz saqlanadi.");
      return;
    case "📋 G'oyalar ombori":
      await tg.sendMessage(CHAT_ID, ideasArchiveReport());
      return;
    case '🔄 Botni yangilash':
      await handleSelfUpdate();
      return;
    case '/start':
      await tg.sendMessage(CHAT_ID, 'Bot tayyor! Pastdagi tugmalardan foydalaning.', { reply_markup: mainKeyboard() });
      return;
  }
  if (awaitingIdea) {
    awaitingIdea = false;
    appendIdea(text);
    await tg.sendMessage(CHAT_ID, `Qabul qilindi va saqlandi: "${text}"`);
    return;
  }
  await handleAiChat(text);
}

async function pollLoop() {
  if (!tg.TOKEN) {
    console.log('Telegram bot: PM_TELEGRAM_BOT_TOKEN topilmadi - bot ochirilgan.');
    return;
  }
  console.log('Telegram bot: tinglash boshlandi (darrov javob beradi).');
  await tg.sendMessage(
    CHAT_ID,
    "Bot yangilandi! Endi botga oddiy xabar yozsangiz Claude AI javob beradi. Mebel kanali boshqaruvi ham shu botda: mavzu/post/autoposting/kalit so'z/guruhlar.",
    { reply_markup: mainKeyboard() }
  );
  moderator.startAutopostLoop();
  kompyuter.startKuzatuv(CHAT_ID);
  let offset = getOffset();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const resp = await tg.getUpdates(offset);
      if (resp && resp.ok && resp.result) {
        for (const update of resp.result) {
          offset = Math.max(offset, update.update_id + 1);
          if (update.callback_query) {
            const cq = update.callback_query;
            if (String(cq.message && cq.message.chat.id) === CHAT_ID && (await claudeSavol.handleCallback(cq))) continue;
            if (String(cq.message && cq.message.chat.id) === CHAT_ID && (await kompyuter.handleCallback(cq))) continue;
            await moderator.handleCallback(cq);
            continue;
          }
          const message = update.message;
          if (!message) continue;
          const chatIdStr = String(message.chat.id);
          if (chatIdStr === CHAT_ID) {
            if (message.text && (await claudeSavol.handleMessage(message))) continue;
            if (message.document && (await bazisShifr.handleDocument(CHAT_ID, message))) continue;
            if (message.photo) await moderator.handlePhoto(message);
            else if (message.text) await handleText(message.text);
          } else if (message.chat.type === 'group' || message.chat.type === 'supergroup') {
            await moderator.handleGroupMessage(message);
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

// Ko'chish (2026-10-27): bot RDPWS2019 (Windows) dan Hetzner serverga ko'chdi. Windows nusxasi "Botni yangilash"
// dan keyin shu yerga keladi: ma'lumotini yangi serverga yuboradi va tinglamaydi — bitta tokenni ikki nusxa
// tinglasa, Telegram 409 xato beradi va xabarlar yo'qoladi.
async function windowsdanKochish() {
  const crypto = require('crypto');
  const https = require('https');
  const files = {};
  for (const f of ['moderator.json', 'ideas.json']) {
    try { files[f] = fs.readFileSync(path.join(__dirname, 'data', f), 'utf8'); } catch {}
  }
  try { files.offset = fs.readFileSync(OFFSET_FILE, 'utf8'); } catch {}
  const body = JSON.stringify({ files, kompyuter: os.hostname() });
  const kalit = crypto.createHash('sha256').update('kochish|' + (process.env.PM_TELEGRAM_BOT_TOKEN || '')).digest('hex');
  const yubor = () => new Promise((resolve) => {
    const req = https.request('https://inok.uz/claude-bot-kochish/', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-kalit': kalit, 'content-length': Buffer.byteLength(body) }, timeout: 30000,
    }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => req.destroy());
    req.end(body);
  });
  for (let i = 0; i < 60 && !(await yubor()); i++) await new Promise((r) => setTimeout(r, 30000));
  try { await tg.sendMessage(CHAT_ID, `Bot ${os.hostname()} dan yangi serverga ko'chirildi, bu nusxa to'xtadi.`); } catch {}
  setInterval(() => {}, 1 << 30); // jim turadi: start-bot-loop.ps1 qayta-qayta yoqmasin
}

if (require.main === module) {
  if (process.platform === 'win32' && fs.existsSync(path.join(__dirname, 'KOCHDI'))) windowsdanKochish();
  else pollLoop();
}

module.exports = { pollLoop };
