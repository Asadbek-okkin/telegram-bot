/* Mustaqil, doimiy ishlaydigan Telegram bot: pack-master yoki boshqa biror loyihaga bog'liq
emas. Tugma bosilganda DARROV javob beradi (long-polling, getUpdates). G'oyalar
arxivi shu faylda; mebel-kanal boshqaruvi (post, autoposting, kalit so'z, guruh) - moderator.js. */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const tg = require('./telegram-api');
const moderator = require('./moderator');
const kompyuter = require('./kompyuter');
const claudeSavol = require('./claude-savol');
const claudeSessiya = require('./claude-sessiya');
const claude = require('./claude-api');
const gemini = require('./gemini-api');
const bazisShifr = require('./bazis-shifr');
const statistika = require('./statistika');
const botlar = require('./botlar');
const agentlar = require('./agentlar');

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

function appendIdea(text) {
  statistika.qayd('goya');
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

// G'oyalar va kanal tugmalari bitta "🗂" tugmasi ichida (asosiy klaviatura ixcham bo'lsin)
const BOSHQA_TUGMA = "🗂 G'oyalar va kanal";
const ORQAGA_TUGMA = '⬅️ Orqaga';

function mainKeyboard() {
  return {
    keyboard: [
      [...kompyuter.KEYBOARD_ROWS[0], '🛡 Botlar'],
      ...claudeSessiya.KEYBOARD_ROWS,
      ['📊 Statistika', '🔄 Botni yangilash'],
      ['🏛 Majlis', '⌨️ Klaviatura', BOSHQA_TUGMA],
    ],
    resize_keyboard: true,
  };
}

function boshqaKeyboard() {
  return {
    keyboard: [
      ["💡 G'oya yozaman", "📋 G'oyalar ombori"],
      ['⏰ Autoposting', "🔑 Kalit so'zlar"],
      ['👁 Guruhlar'],
      [ORQAGA_TUGMA],
    ],
    resize_keyboard: true,
  };
}

// Versiya = commitlar soni (v57 kabi), har yangilanishda o'sadi.
const YANGILANDI_FAYL = path.join(__dirname, 'data', 'yangilandi.json');
let joriyOffset = 0; // pollLoop'dagi offset - qayta ishga tushishdan oldin saqlash uchun
let joriyXabarVaqti = 0; // ishlanayotgan Telegram xabarining vaqti (ms)
const BOSHLANGAN_VAQT = Date.now();

function git(buyruq) {
  return execSync(`git ${buyruq}`, { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function versiya() {
  try {
    return {
      raqam: `v${git('rev-list --count HEAD')}`,
      sana: git('log -1 --format=%cd --date=format:"%d.%m.%Y %H:%M"'),
      hash: git('rev-parse HEAD'),
    };
  } catch {
    return { raqam: 'v?', sana: '', hash: '' };
  }
}

function ozgarishlar(oraliq, max = 10) {
  try {
    const qatorlar = git(`log --format=%s ${oraliq}`).split('\n').filter(Boolean);
    const korsat = qatorlar.slice(0, max).map((q) => `• ${q.length > 120 ? q.slice(0, 119) + '…' : q}`);
    if (qatorlar.length > max) korsat.push(`… va yana ${qatorlar.length - max} ta`);
    return korsat.join('\n');
  } catch {
    return '';
  }
}

// 🆕 Har soat GitHub tekshiriladi: yangi commit bo'lsa bir marta "Yangi versiya chiqdi — yangilang" + tugma
let eslatilganVersiya = null;
function yangiVersiyaKuzat() {
  const tekshir = async () => {
    try {
      git('fetch --quiet');
      const masofaviy = git('rev-parse @{u}');
      if (masofaviy === versiya().hash || masofaviy === eslatilganVersiya) return;
      eslatilganVersiya = masofaviy;
      await tg.sendMessage(CHAT_ID, `🆕 Yangi versiya chiqdi — yangilang!\n\nNimalar o'zgardi:\n${ozgarishlar('HEAD..@{u}') || '•'}`, {
        reply_markup: { inline_keyboard: [[{ text: '🔄 Yangilash', callback_data: 'yangila:hozir' }]] },
      });
    } catch (e) {
      console.error('yangi versiya tekshiruvi:', (e.message || '').slice(0, 200));
    }
  };
  setTimeout(tekshir, 2 * 60 * 1000);
  setInterval(tekshir, 10 * 60 * 1000); // har 10 daqiqa (git fetch - GitHub API limitiga kirmaydi)
}

async function handleSelfUpdate() {
  const eski = versiya();
  await tg.sendMessage(CHAT_ID, `🔄 Yangilanish tekshirilmoqda…\n📦 Hozirgi versiya: ${eski.raqam}`);
  try {
    git('fetch --quiet');
    const masofaviy = git('rev-parse @{u}');
    if (masofaviy === eski.hash) {
      await tg.sendMessage(
        CHAT_ID,
        `✅ Bot so'nggi versiyada — yangilash shart emas.\n\n📦 Versiya: ${eski.raqam}\n📅 ${eski.sana}\n\nOxirgi o'zgarish:\n${ozgarishlar('-1')}`,
      );
      return;
    }
    const yangiliklar = ozgarishlar('HEAD..@{u}');
    git('pull --ff-only --quiet');
    const yangi = versiya();
    try {
      fs.mkdirSync(path.dirname(YANGILANDI_FAYL), { recursive: true });
      fs.writeFileSync(YANGILANDI_FAYL, JSON.stringify({ eski: eski.raqam, yangi: yangi.raqam, yangiliklar }));
    } catch {}
    await tg.sendMessage(
      CHAT_ID,
      `⬇️ Yangi versiya yuklandi: ${eski.raqam} → ${yangi.raqam}\n\nNimalar o'zgardi:\n${yangiliklar || '• (izoh yo\'q)'}\n\n♻️ Bot qayta ishga tushmoqda…`,
    );
    // shu "Botni yangilash" bosilishini o'qilgan deb belgilaymiz - aks holda qayta ishga tushgach Telegram
    // uni yana yuboradi va bot ikkinchi marta tekshirib "so'nggi versiyada" deb chiqarardi.
    setOffset(joriyOffset);
    process.exit(0); // systemd avtomatik qayta ishga tushiradi
  } catch (e) {
    await tg.sendMessage(CHAT_ID, `❌ Yangilashda xato:\n${(e.stderr || e.message || '').toString().trim().slice(0, 1500)}`);
  }
}

function ishgaTushishXabari() {
  const v = versiya();
  let y = null;
  try {
    y = JSON.parse(fs.readFileSync(YANGILANDI_FAYL, 'utf8'));
    fs.unlinkSync(YANGILANDI_FAYL);
  } catch {}
  if (y) return `✅ Bot yangilandi va ishga tushdi!\n\n📦 Versiya: ${y.eski} → ${v.raqam}\n📅 ${v.sana}`;
  return `🟢 Bot ishga tushdi\n📦 Versiya: ${v.raqam} (${v.sana})`;
}

async function handleAiChat(text) {
  conversation.push({ role: 'user', content: text });
  if (conversation.length > HISTORY_MAX) conversation = conversation.slice(-HISTORY_MAX);
  try {
    // 🧠 miya.js: Gemini yoki /miya_ulash bilan ulangan yangi AI (Gemini kaliti bo'lmasa - eski Claude API)
    const reply = gemini.API_KEY ? await require('./miya').fikrla(conversation, AI_SYSTEM_PROMPT) : await aiProvider.chat(conversation, AI_SYSTEM_PROMPT);
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
  if (await claudeSessiya.handleText(CHAT_ID, text)) return;
  if (await statistika.handleText(CHAT_ID, text)) return; // 📊 Statistika (moderatorniki o'rniga)
  if (await botlar.handleText(CHAT_ID, text)) return; // 🛡 Botlar
  if (await require('./claude-limit').handleText(CHAT_ID, text)) return; // 📊 /limit - Claude limiti
  if (await agentlar.handleText(CHAT_ID, text)) return; // 🏛 Majlis, /bot_qosh, /jamoa
  if (await require('./miya').handleText(CHAT_ID, text)) return; // 🧠 /miya, /miya_ulash, /miya_gemini
  if (await require('./klaviatura').handleText(CHAT_ID, text)) return; // ⌨️ Sof Özbek klaviatura APK
  if (await moderator.handleText(text)) return;
  switch (text) {
    case "💡 G'oya yozaman":
      awaitingIdea = true;
      await tg.sendMessage(CHAT_ID, "Mayli, g'oyangizni yozing - keyingi xabaringiz saqlanadi.");
      return;
    case "📋 G'oyalar ombori":
      await tg.sendMessage(CHAT_ID, ideasArchiveReport());
      return;
    case BOSHQA_TUGMA:
      await tg.sendMessage(CHAT_ID, "🗂 G'oyalar va kanal", { reply_markup: boshqaKeyboard() });
      return;
    case ORQAGA_TUGMA:
      await tg.sendMessage(CHAT_ID, 'Asosiy menyu', { reply_markup: mainKeyboard() });
      return;
    case '🔄 Botni yangilash':
      // bot ishga tushishidan oldin bosilgan (qayta yuborilgan) tugma - yangilash allaqachon bo'ldi,
      // ishga tushish xabari versiyani ko'rsatgan; qayta tekshirib chalkashtirmaymiz
      if (joriyXabarVaqti && joriyXabarVaqti < BOSHLANGAN_VAQT) return;
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

// Shaxsiy chatdagi bitta xabar. Natija: 'ok' | 'izohlangan' (o'zi sababini yozdi) | 'tushunmadim'
async function shaxsiyXabar(message) {
  // 🎤 ovozli xabar -> matn; keyin oddiy matn kabi Claude sessiyasiga/savoliga yo'naltiriladi
  const ovoz = message.voice || message.audio || message.video_note;
  if (ovoz && !message.text) {
    try {
      const buf = await tg.faylYukla(ovoz.file_id);
      const matn = await gemini.transkript(buf, ovoz.mime_type || (message.video_note ? 'video/mp4' : 'audio/ogg'));
      if (!matn) {
        await tg.sendMessage(CHAT_ID, '🤷 Tushunmadim — ovozli xabarda gap eshitilmadi.', { reply_to_message_id: message.message_id });
        return 'izohlangan';
      }
      await tg.sendMessage(CHAT_ID, `🎤 Eshitdim: ${matn}`, { reply_to_message_id: message.message_id });
      statistika.qayd('ovoz');
      message.text = matn;
    } catch (e) {
      console.error('ovoz:', e.message);
      await tg.sendMessage(CHAT_ID, `🤷 Tushunmadim — ovozni matnga aylantirib bo'lmadi: ${e.message}`, { reply_to_message_id: message.message_id });
      return 'izohlangan';
    }
  }
  if (message.text && (await claudeSessiya.handleMessage(message))) return 'ok';
  if (message.text && (await claudeSavol.handleMessage(message))) return 'ok';
  if (message.text && (await claudeSessiya.handleFallback(message))) return 'ok';
  // 🖼 skrinshot + izoh -> Claude sessiyasiga (reply / ochiq karta / tanlash); sessiya yo'q bo'lsa - kanal posti
  if ((message.photo || message.document)
    && (await claudeSessiya.handlePhoto(message, (m) => (m.photo ? moderator.handlePhoto(m) : tg.sendMessage(CHAT_ID, 'Kanalga faqat rasm (fayl emas) yuboriladi.'))))) return 'ok';
  if (message.document && (await bazisShifr.handleDocument(CHAT_ID, message))) return 'ok';
  if (message.photo) {
    await moderator.handlePhoto(message);
    return 'ok';
  }
  if (message.text) {
    joriyXabarVaqti = (message.date || 0) * 1000;
    await handleText(message.text);
    return 'ok';
  }
  return 'tushunmadim'; // stiker, noma'lum fayl va h.k.
}

async function pollLoop() {
  if (!tg.TOKEN) {
    console.log('Telegram bot: PM_TELEGRAM_BOT_TOKEN topilmadi - bot ochirilgan.');
    return;
  }
  console.log('Telegram bot: tinglash boshlandi (darrov javob beradi).');
  await tg.sendMessage(CHAT_ID, ishgaTushishXabari(), { reply_markup: mainKeyboard() });
  moderator.startAutopostLoop();
  kompyuter.startKuzatuv(CHAT_ID);
  botlar.start(CHAT_ID, claudeSessiya.kuzatuvchigaBuyruq);
  yangiVersiyaKuzat();
  require('./claude-limit').start(CHAT_ID, botlar.guruhniOl);
  agentlar.start(CHAT_ID, botlar.guruhniOl, botlar.guruhHolati); // 🏛 kunlik majlis
  require('./klaviatura').start(CHAT_ID); // ⌨️ klaviatura yangi versiyasini obunachilarga yuboradi
  let offset = getOffset();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const resp = await tg.getUpdates(offset);
      if (resp && resp.ok && resp.result) {
        for (const update of resp.result) {
          offset = Math.max(offset, update.update_id + 1);
          joriyOffset = offset;
          if (update.callback_query) {
            const cq = update.callback_query;
            if (String(cq.message && cq.message.chat.id) === CHAT_ID && (await claudeSavol.handleCallback(cq))) continue;
            if (String(cq.message && cq.message.chat.id) === CHAT_ID && (await claudeSessiya.handleCallback(cq))) continue;
            if (String(cq.message && cq.message.chat.id) === CHAT_ID && (await statistika.handleCallback(cq))) continue;
            if (String(cq.message && cq.message.chat.id) === CHAT_ID && (await botlar.handleCallback(cq))) continue;
            if (String(cq.message && cq.message.chat.id) === CHAT_ID && (await agentlar.handleCallback(cq))) continue;
            if (String(cq.message && cq.message.chat.id) === CHAT_ID && cq.data === 'yangila:hozir') {
              await tg.answerCallbackQuery(cq.id, { text: 'Yangilanmoqda…' });
              await handleSelfUpdate(); // 🆕 "Yangi versiya chiqdi" xabaridagi tugma
              continue;
            }
            if (String(cq.message && cq.message.chat.id) === CHAT_ID && (await kompyuter.handleCallback(cq))) continue;
            await moderator.handleCallback(cq);
            continue;
          }
          const message = update.message;
          if (!message) continue;
          const chatIdStr = String(message.chat.id);
          if (chatIdStr === CHAT_ID) {
            // 👀 = xabar ko'rildi, ishlanmoqda; 👌 = bajarildi; 🤷 = tushunmadi (Telegram reaksiyalarida ✅ yo'q)
            tg.reaksiya(CHAT_ID, message.message_id, '👀');
            let natija;
            try {
              natija = await shaxsiyXabar(message);
            } catch (e) {
              console.error('xabar ishlovi:', e.message);
              natija = 'xato';
            }
            if (natija === 'ok') {
              tg.reaksiya(CHAT_ID, message.message_id, '👌');
            } else {
              tg.reaksiya(CHAT_ID, message.message_id, '🤷');
              if (natija === 'tushunmadim') {
                await tg.sendMessage(CHAT_ID, "🤷 Tushunmadim. Matn, 🎤 ovozli xabar yoki 🖼 rasm yuboring, yoki pastdagi tugmalardan foydalaning.", { reply_to_message_id: message.message_id });
              } else if (natija === 'xato') {
                await tg.sendMessage(CHAT_ID, "🤷 Tushunmadim — ishlashda xato chiqdi. Qayta urinib ko'ring.", { reply_to_message_id: message.message_id });
              }
            }
          } else if (message.chat.type === 'private') {
            await require('./klaviatura').begona(message); // ⌨️ do'stlar /start -> klaviatura APK
          } else if (message.chat.type === 'group' || message.chat.type === 'supergroup') {
            if (await botlar.handleGroupMessage(message)) continue; // 🛡 botlar taxtasi guruhi
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
