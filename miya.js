/* 🧠 Miya - Claude Asadbek'ning "o'ylovchi" qismi almashtiriladigan qilib ajratilgan.
Hozir: Google Gemini. Kelajakda: o'zimizning yangi sun'iy intellekt - bot kodiga tegmasdan ulanadi.

Yangi AI ulash (shaxsiy chatda, faqat egasi):
  /miya                                  - hozirgi miya va holati
  /miya_ulash Nomi | https://.../v1 | model | kalit   - OpenAI'ga mos (chat/completions) har qanday AI
  /miya_gemini                           - Gemini'ga qaytish
Yangi AI ishlamay qolsa (xato/vaqt tugadi) - avtomatik Gemini'ga qaytadi, javob yo'qolmaydi.
Batafsil: AI-ULASH.md */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const gemini = require('./gemini-api');
const tg = require('./telegram-api');

const FAYL = path.join(__dirname, 'data', 'miya.json'); // git'da emas (kalit shu yerda)

function sozlama() {
  try { return JSON.parse(fs.readFileSync(FAYL, 'utf8')); } catch { return { tur: 'gemini' }; }
}
function saqla(s) {
  fs.mkdirSync(path.dirname(FAYL), { recursive: true });
  fs.writeFileSync(FAYL, JSON.stringify(s));
}

// OpenAI'ga mos API: POST {url}/chat/completions {model, messages}
function openaiMos(s, messages, tizim) {
  return new Promise((resolve, reject) => {
    const u = new URL(s.url.replace(/\/+$/, '') + '/chat/completions');
    const body = JSON.stringify({ model: s.model, messages: [...(tizim ? [{ role: 'system', content: tizim }] : []), ...messages] });
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'POST', timeout: 120000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...(s.kalit ? { Authorization: `Bearer ${s.kalit}` } : {}) } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          const matn = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
          if (res.statusCode >= 300 || !matn) return reject(new Error((j.error && (j.error.message || j.error)) || `HTTP ${res.statusCode}`));
          resolve(String(matn));
        } catch (e) { reject(new Error(`javob o'qilmadi (HTTP ${res.statusCode})`)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('vaqt tugadi')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

let oxirgiXato = '';

// Asosiy funksiya: messages = [{role:'user'|'assistant', content}], tizim = system prompt -> matn
async function fikrla(messages, tizim) {
  const s = sozlama();
  if (s.tur === 'openai' && s.url) {
    try {
      const m = await openaiMos(s, messages, tizim);
      oxirgiXato = '';
      return m;
    } catch (e) {
      oxirgiXato = `${new Date().toISOString().slice(0, 16)} ${e.message}`;
      console.error('miya (yangi AI) xato, Gemini ishlatildi:', e.message);
    }
  }
  try {
    return await gemini.chat(messages, tizim); // ichida bir nechta bepul Gemini modeli navbat bilan
  } catch (e) {
    // Gemini bepul limiti tugadi/ishlamadi - bepul zaxira AI'lar (/miya_zaxira), yordamchi to'xtab qolmasin
    for (const z of s.zaxiralar || []) {
      try {
        const m = await openaiMos(z, messages, tizim);
        if (e.kvota) ogohlantir(`⚠️ Gemini bepul limiti tugadi — AI yordamchi hozir zaxira «${z.nomi}» bilan ishlayapti.`);
        return m;
      } catch (e2) {
        console.error(`miya zaxira ${z.nomi}:`, e2.message);
      }
    }
    if (e.kvota) ogohlantir("⚠️ AI yordamchining bepul limiti tugadi (Gemini). 30 daqiqadan keyin qayta urinadi.\n"
      + "To'xtab qolmasligi uchun bepul zaxira AI qo'shing: /miya_zaxira (masalan Groq yoki OpenRouter bepul kaliti).");
    throw e;
  }
}

let oxirgiOgoh = 0;
function ogohlantir(matn) {
  if (Date.now() - oxirgiOgoh < 6 * 3600 * 1000) return; // 6 soatda bir martadan ko'p emas
  oxirgiOgoh = Date.now();
  tg.sendMessage(process.env.PM_TELEGRAM_CHAT_ID || '313364362', matn).catch(() => {});
}

function nomi() {
  const s = sozlama();
  return s.tur === 'openai' ? `${s.nomi || 'Yangi AI'} (${s.model})` : 'Google Gemini';
}

async function handleText(chatId, text) {
  const t = String(text || '').trim();
  if (/^\/miya$/i.test(t)) {
    await tg.sendMessage(chatId, `🧠 Claude Asadbek miyasi: ${nomi()}${oxirgiXato ? `\n⚠️ Oxirgi xato (Gemini'ga o'tildi): ${oxirgiXato}` : ''}\n\n`
      + "Yangi AI ulash:\n/miya_ulash Nomi | https://manzil/v1 | model | kalit\n(OpenAI'ga mos chat/completions API)\nGemini'ga qaytish: /miya_gemini");
    return true;
  }
  if (/^\/miya_zaxira\b/i.test(t)) {
    const [nom, url, model, kalit] = t.replace(/^\/miya_zaxira\s*/i, '').split('|').map((x) => (x || '').trim());
    const s = sozlama();
    if (!nom) {
      const z = (s.zaxiralar || []).map((x, i) => `${i + 1}. ${x.nomi} (${x.model})`).join('\n') || "— yo'q";
      await tg.sendMessage(chatId, `🛟 Zaxira AI'lar (Gemini limiti tugasa navbat bilan):\n${z}\n\nQo'shish: /miya_zaxira Nomi | https://manzil/v1 | model | kalit\n`
        + "Bepul variantlar: Groq (console.groq.com → API key; https://api.groq.com/openai/v1 | llama-3.3-70b-versatile), "
        + "OpenRouter (openrouter.ai → keys; https://openrouter.ai/api/v1 | ':free' bilan tugaydigan model).\nHammasini o'chirish: /miya_zaxira tozala");
      return true;
    }
    if (/^tozala$/i.test(nom)) {
      s.zaxiralar = [];
      saqla(s);
      await tg.sendMessage(chatId, '🗑 Zaxira AI\'lar o\'chirildi.');
      return true;
    }
    if (!/^https?:\/\//.test(url || '') || !model) {
      await tg.sendMessage(chatId, 'Format: /miya_zaxira Nomi | https://manzil/v1 | model | kalit');
      return true;
    }
    const z = { nomi: nom, url, model, kalit: kalit || '' };
    try {
      await openaiMos(z, [{ role: 'user', content: 'Salom' }], 'Bitta so\'z bilan javob ber.');
    } catch (e) {
      await tg.sendMessage(chatId, `❌ ${nom} ishlamadi: ${e.message}`);
      return true;
    }
    s.zaxiralar = [...(s.zaxiralar || []).filter((x) => x.nomi !== nom), z].slice(0, 5);
    saqla(s);
    await tg.sendMessage(chatId, `✅ «${nom}» zaxira sifatida qo'shildi. Gemini limiti tugasa AI yordamchi shu bilan davom etadi.\nKalitli xabaringizni o'chirib qo'ying.`);
    return true;
  }
  if (/^\/miya_gemini$/i.test(t)) {
    saqla({ tur: 'gemini', zaxiralar: sozlama().zaxiralar || [] });
    await tg.sendMessage(chatId, '🧠 Miya: Google Gemini ga qaytarildi.');
    return true;
  }
  if (/^\/miya_ulash\b/i.test(t)) {
    const [nom, url, model, kalit] = t.replace(/^\/miya_ulash\s*/i, '').split('|').map((x) => (x || '').trim());
    if (!nom || !/^https?:\/\//.test(url || '') || !model) {
      await tg.sendMessage(chatId, "Format: /miya_ulash Nomi | https://manzil/v1 | model | kalit\nMisol: /miya_ulash Bizning AI | https://ai.inok.uz/v1 | asad-1 | sk-...");
      return true;
    }
    const s = { tur: 'openai', nomi: nom, url, model, kalit: kalit || '', zaxiralar: sozlama().zaxiralar || [] };
    await tg.sendMessage(chatId, `⏳ ${nom} sinab ko'rilmoqda…`);
    try {
      const javob = await openaiMos(s, [{ role: 'user', content: "Salom! Bir gapda o'zingni tanishtir." }], "O'zbek tilida qisqa javob ber.");
      saqla(s);
      await tg.sendMessage(chatId, `✅ ${nom} ulandi — endi Claude Asadbek u bilan o'ylaydi (reja, majlis, tekshiruv, suhbat).\nSinov javobi: ${javob.slice(0, 500)}\n\nXavfsizlik: kalitli xabaringizni o'chirib qo'ying.`);
    } catch (e) {
      await tg.sendMessage(chatId, `❌ Ulanmadi: ${e.message}\nMiya o'zgarmadi (${nomi()}).`);
    }
    return true;
  }
  return false;
}

module.exports = { fikrla, nomi, handleText };
