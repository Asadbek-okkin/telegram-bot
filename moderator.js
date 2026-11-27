/* Mebel kanali uchun AI-post generatsiya, mavzular ombori, autoposting, kalit so'zlar va
guruh kuzatish. Asl mantiq C:\Users\admin\Desktop\mebel_bot\mebel_bot.py (aiogram/Python,
alohida "mebel_moderator" bot) dan ko'chirilgan - endi shu bitta botda (bot.js) ishlaydi,
alohida token kerak emas. CHAT_ID - yagona admin (xuddi bot.js dagidek). */
const fs = require('fs');
const path = require('path');
const https = require('https');
const tg = require('./telegram-api');

const CHAT_ID = '313364362';
const DATA_FILE = path.join(__dirname, 'data', 'moderator.json');
const KANAL = process.env.PM_KANAL || '@asadbek_Yusupoov';
const GROQ_API_KEY = process.env.PM_GROQ_API_KEY;
const GROQ_MODEL = 'llama-3.3-70b-versatile';

const KANAL_YONALISH = `
Kanal yo'nalishi: Mebel olami — dizayner, konstruktor yoki ishboshqaruvchi nuqtai nazaridan.
Tayyor mebellar emas, ularning yaratilish jarayoni, real qiyinchiliklar va yechimlar haqida samimiy.
Mavzular: furnitura, konstruksiya, 3d model, CNC/CHPu, smeta, karta kroy, shkaf, garderob,
spalniy, krovat, bolalar krovati, penal, giblab, bazis, krepyoj, birka va shunga o'xshash.
`;

const DEFAULTS = {
  mavzular: [],
  statistika: [],
  autopost: { yoniq: false, soat: '10:00', mavzu_index: 0 },
  kalit_sozlar: [
    'furnitura', 'krepyoj', 'mebel', 'kunya', 'konstruksiya',
    'bazis', 'karta kroy', 'giblab', '3d model', 'smeta',
    'shkaf', 'spalniy', 'krovat', 'garderob', 'bolalar krovati',
    'penal', 'birka', 'chpu', 'cnc', 'loyiha', 'furnit',
  ],
  guruhlar: ['@Bazischichat'],
};

const KEYBOARD_ROWS = [
  ['⏰ Autoposting', '📊 Statistika'],
  ["🔑 Kalit so'zlar", '👁 Guruhlar'],
  ['📝 Yangi post'],
];

function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
}

function save(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function soatAmpm(soat) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(soat || '');
  if (!m) return soat;
  const h = Number(m[1]);
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 || 12;
  return `${h12}:${m[2]} ${ampm}`;
}

function formatSana(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function commandArg(text) {
  const idx = text.indexOf(' ');
  return idx === -1 ? '' : text.slice(idx + 1).trim();
}

// Groq ishlamasa (kalit eskirgan "Invalid API Key", limit) - 🧠 miya.js (Gemini + zaxiralar) bilan davom etadi
async function groqChat(messages, maxTokens) {
  try {
    return await groqChatToza(messages, maxTokens);
  } catch (e) {
    console.error('moderator Groq xato, miya.js ishlatildi:', e.message);
    return require('./miya').fikrla(messages, "Faqat so'ralgan matnni yoz. Markdown ishlatma.");
  }
}

function groqChatToza(messages, maxTokens) {
  return new Promise((resolve, reject) => {
    if (!GROQ_API_KEY) { reject(new Error("PM_GROQ_API_KEY o'rnatilmagan")); return; }
    const body = JSON.stringify({ model: GROQ_MODEL, messages, max_tokens: maxTokens });
    const req = https.request(
      {
        hostname: 'api.groq.com',
        path: '/openai/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GROQ_API_KEY}`,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (parsed.error) { reject(new Error(parsed.error.message || 'Groq xato')); return; }
            resolve(parsed.choices[0].message.content);
          } catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function postYaratish(mavzu) {
  const mavzuQism = mavzu ? `Mavzu: '${mavzu}'\n` : '';
  const content =
    `Quyidagi kanal uchun bitta post yoz:\n${KANAL_YONALISH}\n\n` +
    mavzuQism +
    `Post formati (barchasi BITTA xabarda):\n` +
    `1. Avval O'ZBEK tilida yoz (80-100 so'z), boshida bitta emoji\n` +
    `2. Keyin yangi qatorda faqat: ---\n` +
    `3. Keyin RUS tilida xuddi shu postni yoz (80-100 so'z), boshida bitta emoji\n` +
    `4. Eng oxirida yangi qatorda: 👉 ${KANAL}\n\n` +
    `O'rtada boshqa emoji ishlatma. Markdown belgisi ishlatma. Faqat oddiy matn.`;
  return groqChat([{ role: 'user', content }], 1024);
}

async function guruhMavzuTopish(xabar) {
  const content =
    `Quyidagi xabarni o'qi va mebel/dizayn/konstruksiya sohasiga oid mavzu chiqar:\n\n` +
    `Xabar: ${xabar}\n\n` +
    `Kanal yo'nalishi: ${KANAL_YONALISH}\n\n` +
    `Agar xabar soha bilan bog'liq bo'lsa, qisqa mavzu nomi yoz (5-10 so'z, imlosiz xatolar bo'lsa to'g'irla).\n` +
    `Agar bog'liq bo'lmasa, faqat: YOQ\n` +
    `Faqat mavzu nomini yoz, boshqa hech narsa yozma.`;
  const natija = (await groqChat([{ role: 'user', content }], 50)).trim();
  if (natija.toUpperCase() === 'YOQ' || natija.length < 3) return null;
  return natija;
}

function postTugmalari(postId) {
  return {
    inline_keyboard: [
      [{ text: '✅ Kanalga yuborish', callback_data: `yuborish:${postId}` },
        { text: '🔄 Yangi variantlar', callback_data: `variantlar:${postId}` }],
      [{ text: "⏰ Autoposts ga qo'sh", callback_data: `autoq:${postId}` },
        { text: '❌ Bekor', callback_data: `bekor:${postId}` }],
    ],
  };
}

function variantlarTugmalari(postId, soni) {
  const buttons = [];
  for (let i = 0; i < soni; i++) buttons.push([{ text: `📝 ${i + 1}-variant`, callback_data: `variant:${postId}:${i}` }]);
  buttons.push([{ text: '◀️ Orqaga', callback_data: `orqaga:${postId}` }]);
  return { inline_keyboard: buttons };
}

function omborTugmalari(mavzular) {
  const buttons = mavzular.map((m, i) => [{ text: `📌 ${m}`, callback_data: `ombor:${i}` }]);
  buttons.push([{ text: '🗑 Omborni tozalash', callback_data: 'ombor_tozala' }]);
  return { inline_keyboard: buttons };
}

function autopostTugmalari(data) {
  const ap = data.autopost;
  return {
    inline_keyboard: [
      [{ text: `Holat: ${ap.yoniq ? '🟢 Yoniq' : "🔴 O'chiq"}`, callback_data: 'ap_toggle' }],
      [{ text: `⏰ Vaqt: ${soatAmpm(ap.soat)}`, callback_data: 'ap_soat' }],
      [
        { text: '🌅 Ertalab', callback_data: 'ap_preset:09:00' },
        { text: '☀️ Kunduz', callback_data: 'ap_preset:13:00' },
        { text: '🌆 Kechqurun', callback_data: 'ap_preset:18:00' },
      ],
    ],
  };
}

function autopostText(data) {
  const ap = data.autopost;
  const mavzular = data.mavzular || [];
  let text =
    `Autoposting sozlamalari\n\n` +
    `Holat: ${ap.yoniq ? '🟢 Yoniq' : "🔴 O'chiq"}\n` +
    `Vaqt: ${soatAmpm(ap.soat)} (har kuni)\n` +
    `Mavzular soni: ${mavzular.length}\n`;
  if (!mavzular.length) text += "\nOgohlantirish: Mavzular ombori bo'sh!";
  return text;
}

const pendingPosts = new Map(); // postId -> { text, mavzu, photo }
const pendingVariants = new Map(); // postId -> [variant text...]
let pendingInput = null; // { type: 'mavzu' } | { type: 'autopost_soat' }
let lastAutopostKey = null;

function newPostId() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

async function yuborPost(chatId, messageId, mavzu, photo) {
  let workingMessageId = messageId;
  if (workingMessageId) {
    await tg.editMessageText(chatId, workingMessageId, 'Post tayyorlanmoqda...');
  } else {
    const sent = await tg.sendMessage(chatId, 'Post tayyorlanmoqda...');
    if (!sent || !sent.ok) return;
    workingMessageId = sent.result.message_id;
  }
  try {
    const postText = await postYaratish(mavzu);
    const postId = newPostId();
    pendingPosts.set(postId, { text: postText, mavzu, photo });
    const mavzuQator = mavzu ? `Mavzu: ${mavzu}\n\n` : '';
    await tg.editMessageText(chatId, workingMessageId, `Post tayyorlandi:\n\n${mavzuQator}${postText}`, {
      reply_markup: postTugmalari(postId),
    });
    if (mavzu) {
      const data = load();
      if (!data.mavzular.includes(mavzu)) {
        data.mavzular.push(mavzu);
        save(data);
      }
    }
  } catch (e) {
    await tg.editMessageText(chatId, workingMessageId, `Xatolik: ${e.message}`);
  }
}

async function handleText(text) {
  if (pendingInput && pendingInput.type === 'mavzu') {
    pendingInput = null;
    await yuborPost(CHAT_ID, null, text.trim());
    return true;
  }
  if (pendingInput && pendingInput.type === 'autopost_soat') {
    const soat = text.trim();
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(soat)) {
      await tg.sendMessage(CHAT_ID, "Noto'g'ri format! Masalan: 10:00");
      return true;
    }
    pendingInput = null;
    const data = load();
    data.autopost.soat = soat;
    save(data);
    await tg.sendMessage(CHAT_ID, `Autoposting vaqti ${soat} ga o'rnatildi!`);
    return true;
  }

  switch (text) {
    case '✏️ Mavzu berish':
      pendingInput = { type: 'mavzu' };
      await tg.sendMessage(CHAT_ID, 'Mavzuni yozing:');
      return true;
    case '📦 Mavzular ombori': {
      const data = load();
      const mavzular = data.mavzular || [];
      if (mavzular.length) await tg.sendMessage(CHAT_ID, `Mavzular ombori (${mavzular.length} ta):`, { reply_markup: omborTugmalari(mavzular) });
      else await tg.sendMessage(CHAT_ID, "Ombor bo'sh!");
      return true;
    }
    case '📝 Yangi post':
      await yuborPost(CHAT_ID, null, '');
      return true;
    case '⏰ Autoposting': {
      const data = load();
      await tg.sendMessage(CHAT_ID, autopostText(data), { reply_markup: autopostTugmalari(data) });
      return true;
    }
    case '📊 Statistika': {
      const data = load();
      const statistika = data.statistika || [];
      if (!statistika.length) {
        await tg.sendMessage(CHAT_ID, 'Hali post yuborilmagan.');
        return true;
      }
      let textOut = `Statistika\n\nJami postlar: ${statistika.length}\n\nOxirgi 5 ta:\n`;
      for (const s of statistika.slice(-5).reverse()) textOut += `\n${s.sana} | ${s.mavzu}\n`;
      await tg.sendMessage(CHAT_ID, textOut);
      return true;
    }
    case "🔑 Kalit so'zlar": {
      const data = load();
      const kalit = data.kalit_sozlar || [];
      let textOut = `Kalit so'zlar (${kalit.length} ta):\n\n${kalit.map((k, i) => `${i + 1}. ${k}`).join('\n')}`;
      textOut += "\n\nQo'shish uchun: /kalit_qosh so'z\nO'chirish uchun: /kalit_ochir so'z";
      await tg.sendMessage(CHAT_ID, textOut);
      return true;
    }
    case '👁 Guruhlar': {
      const data = load();
      const guruhlar = data.guruhlar || [];
      let textOut = `Kuzatilayotgan guruhlar (${guruhlar.length} ta):\n\n${guruhlar.map((g, i) => `${i + 1}. ${g}`).join('\n')}`;
      textOut += "\n\nQo'shish: /guruh_qosh @username\nO'chirish: /guruh_ochir @username";
      await tg.sendMessage(CHAT_ID, textOut);
      return true;
    }
    default:
      break;
  }

  if (text.startsWith('/kalit_qosh')) {
    const kalit = commandArg(text).toLowerCase();
    if (!kalit) { await tg.sendMessage(CHAT_ID, "Ishlatish: /kalit_qosh so'z"); return true; }
    const data = load();
    if (!data.kalit_sozlar.includes(kalit)) {
      data.kalit_sozlar.push(kalit);
      save(data);
      await tg.sendMessage(CHAT_ID, `'${kalit}' kalit so'z qo'shildi!`);
    } else {
      await tg.sendMessage(CHAT_ID, `'${kalit}' allaqachon bor!`);
    }
    return true;
  }
  if (text.startsWith('/kalit_ochir')) {
    const kalit = commandArg(text).toLowerCase();
    if (!kalit) { await tg.sendMessage(CHAT_ID, "Ishlatish: /kalit_ochir so'z"); return true; }
    const data = load();
    const idx = data.kalit_sozlar.indexOf(kalit);
    if (idx !== -1) {
      data.kalit_sozlar.splice(idx, 1);
      save(data);
      await tg.sendMessage(CHAT_ID, `'${kalit}' o'chirildi!`);
    } else {
      await tg.sendMessage(CHAT_ID, `'${kalit}' topilmadi!`);
    }
    return true;
  }
  if (text.startsWith('/guruh_qosh')) {
    let guruh = commandArg(text);
    if (!guruh) { await tg.sendMessage(CHAT_ID, 'Ishlatish: /guruh_qosh @username'); return true; }
    if (!guruh.startsWith('@') && !guruh.startsWith('-')) guruh = `@${guruh}`;
    const data = load();
    if (!data.guruhlar.includes(guruh)) {
      data.guruhlar.push(guruh);
      save(data);
      await tg.sendMessage(CHAT_ID, `'${guruh}' guruh qo'shildi!\n\nEslatma: Botni o'sha guruhga a'zo qiling!`);
    } else {
      await tg.sendMessage(CHAT_ID, `'${guruh}' allaqachon bor!`);
    }
    return true;
  }
  if (text.startsWith('/guruh_ochir')) {
    let guruh = commandArg(text);
    if (!guruh) { await tg.sendMessage(CHAT_ID, 'Ishlatish: /guruh_ochir @username'); return true; }
    if (!guruh.startsWith('@')) guruh = `@${guruh}`;
    const data = load();
    const idx = data.guruhlar.indexOf(guruh);
    if (idx !== -1) {
      data.guruhlar.splice(idx, 1);
      save(data);
      await tg.sendMessage(CHAT_ID, `'${guruh}' o'chirildi!`);
    } else {
      await tg.sendMessage(CHAT_ID, `'${guruh}' topilmadi!`);
    }
    return true;
  }

  return false;
}

async function handlePhoto(message) {
  const mavzu = message.caption || '';
  const photo = message.photo[message.photo.length - 1].file_id;
  await yuborPost(CHAT_ID, null, mavzu, photo);
}

async function handleCallback(cq) {
  const data = cq.data;
  const chatId = cq.message.chat.id;
  const messageId = cq.message.message_id;

  if (data.startsWith('yuborish:')) {
    const postId = data.split(':')[1];
    const post = pendingPosts.get(postId);
    if (post) {
      try {
        if (post.photo) await tg.sendPhoto(KANAL, post.photo, { caption: post.text });
        else await tg.sendMessage(KANAL, post.text);
        const d = load();
        d.statistika.push({ sana: formatSana(new Date()), mavzu: post.mavzu || 'Umumiy', post: post.text.slice(0, 100) });
        save(d);
        pendingPosts.delete(postId);
        await tg.editMessageText(chatId, messageId, 'Post kanalga yuborildi!');
      } catch (e) {
        await tg.answerCallbackQuery(cq.id, { text: `Xato: ${e.message}`, show_alert: true });
      }
    }
  } else if (data.startsWith('variantlar:')) {
    const postId = data.split(':')[1];
    const post = pendingPosts.get(postId) || {};
    await tg.editMessageText(chatId, messageId, '3 variant tayyorlanmoqda...');
    const variantlar = await Promise.all([0, 1, 2].map(() => postYaratish(post.mavzu || '')));
    pendingVariants.set(postId, variantlar);
    let textOut = '';
    variantlar.forEach((v, i) => { textOut += `${i + 1}-variant:\n${v}\n\n---\n\n`; });
    await tg.editMessageText(chatId, messageId, textOut.length > 4000 ? textOut.slice(0, 4000) : textOut, {
      reply_markup: variantlarTugmalari(postId, variantlar.length),
    });
  } else if (data.startsWith('variant:')) {
    const [, postId, idxStr] = data.split(':');
    const idx = Number(idxStr);
    const variantlar = pendingVariants.get(postId) || [];
    if (idx < variantlar.length) {
      const post = pendingPosts.get(postId) || {};
      post.text = variantlar[idx];
      pendingPosts.set(postId, post);
      const mavzuQator = post.mavzu ? `Mavzu: ${post.mavzu}\n\n` : '';
      await tg.editMessageText(chatId, messageId, `Tanlangan variant:\n\n${mavzuQator}${variantlar[idx]}`, {
        reply_markup: postTugmalari(postId),
      });
    }
  } else if (data.startsWith('orqaga:')) {
    const postId = data.split(':')[1];
    const post = pendingPosts.get(postId) || {};
    const mavzuQator = post.mavzu ? `Mavzu: ${post.mavzu}\n\n` : '';
    await tg.editMessageText(chatId, messageId, `Post:\n\n${mavzuQator}${post.text || ''}`, { reply_markup: postTugmalari(postId) });
  } else if (data.startsWith('autoq:')) {
    const postId = data.split(':')[1];
    const post = pendingPosts.get(postId);
    const d = load();
    if (post && post.mavzu && !d.mavzular.includes(post.mavzu)) {
      d.mavzular.push(post.mavzu);
      save(d);
    }
    await tg.answerCallbackQuery(cq.id, { text: "Mavzu autopostingga qo'shildi!", show_alert: true });
  } else if (data.startsWith('bekor:')) {
    const postId = data.split(':')[1];
    pendingPosts.delete(postId);
    await tg.editMessageText(chatId, messageId, 'Bekor qilindi.');
  } else if (data.startsWith('ombor:')) {
    const idx = Number(data.split(':')[1]);
    const d = load();
    const mavzu = d.mavzular[idx];
    if (mavzu) await yuborPost(chatId, messageId, mavzu);
  } else if (data === 'ombor_tozala') {
    const d = load();
    d.mavzular = [];
    save(d);
    await tg.editMessageText(chatId, messageId, 'Ombor tozalandi!');
  } else if (data === 'ap_toggle') {
    const d = load();
    d.autopost.yoniq = !d.autopost.yoniq;
    save(d);
    await tg.answerCallbackQuery(cq.id, { text: `Autoposting: ${d.autopost.yoniq ? '🟢 Yoniq' : "🔴 O'chiq"}` });
    await tg.editMessageText(chatId, messageId, autopostText(d), { reply_markup: autopostTugmalari(d) });
  } else if (data === 'ap_soat') {
    pendingInput = { type: 'autopost_soat' };
    await tg.sendMessage(CHAT_ID, 'Soatni yozing (masalan: 10:00 yoki 18:30):');
  } else if (data.startsWith('ap_preset:')) {
    const soat = data.split(':').slice(1).join(':');
    const d = load();
    d.autopost.soat = soat;
    save(d);
    await tg.answerCallbackQuery(cq.id, { text: `Vaqt ${soatAmpm(soat)} ga o'rnatildi!`, show_alert: true });
    await tg.editMessageText(chatId, messageId, autopostText(d), { reply_markup: autopostTugmalari(d) });
    return;
  }

  try { await tg.answerCallbackQuery(cq.id); } catch { /* already answered above for some branches */ }
}

async function handleGroupMessage(message) {
  if (!message.text) return;
  const d = load();
  const guruhlar = d.guruhlar || [];
  const chatUsername = (message.chat.username || '').toLowerCase();
  const chatIdStr = String(message.chat.id);
  const matched = guruhlar.some((raw) => {
    const g = raw.trim();
    if (g.startsWith('-')) return g === chatIdStr;
    return g.toLowerCase().replace('@', '') === chatUsername;
  });
  if (!matched) return;

  const kalitSozlar = (d.kalit_sozlar || []).map((k) => k.toLowerCase());
  const xabar = message.text.toLowerCase();
  if (!kalitSozlar.some((k) => xabar.includes(k))) return;

  try {
    const mavzu = await guruhMavzuTopish(message.text);
    if (mavzu && !d.mavzular.includes(mavzu)) {
      d.mavzular.push(mavzu);
      save(d);
      require('./statistika').qayd('mavzu');
      await tg.sendMessage(
        CHAT_ID,
        `Guruhdan yangi mavzu saqlandi!\n\nGuruh: @${chatUsername}\nMavzu: ${mavzu}\nAsl xabar: ${message.text.slice(0, 100)}...`
      );
    }
  } catch (e) {
    console.error('Tahlil xato:', e.message);
  }
}

function startAutopostLoop() {
  setInterval(async () => {
    try {
      const d = load();
      const ap = d.autopost;
      if (!ap.yoniq) return;
      const now = new Date();
      const [apH, apM] = ap.soat.split(':').map(Number);
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const apMin = apH * 60 + apM;
      const inWindow = nowMin - apMin >= 0 && nowMin - apMin < 5;
      const dayKey = `${ap.soat}${formatSana(now).split(' ')[0].replace(/\./g, '')}`;
      if (!inWindow || lastAutopostKey === dayKey) return;

      const mavzular = d.mavzular || [];
      if (!mavzular.length) {
        await tg.sendMessage(CHAT_ID, "⚠️ Autoposting: Mavzular ombori bo'sh!");
        return;
      }
      const idx = (ap.mavzu_index || 0) % mavzular.length;
      const mavzu = mavzular[idx];
      const postText = await postYaratish(mavzu);
      await tg.sendMessage(KANAL, postText);
      d.statistika.push({ sana: formatSana(now), mavzu, post: postText.slice(0, 100) });
      d.autopost.mavzu_index = idx + 1;
      save(d);
      lastAutopostKey = dayKey;
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      await tg.sendMessage(CHAT_ID, `✅ Autopost yuborildi!\nMavzu: ${mavzu}\nVaqt: ${hh}:${mm}`);
    } catch (e) {
      console.error('Autopost xato:', e.message);
    }
  }, 30000);
}

module.exports = {
  CHAT_ID,
  KEYBOARD_ROWS,
  handleText,
  handlePhoto,
  handleCallback,
  handleGroupMessage,
  startAutopostLoop,
};
