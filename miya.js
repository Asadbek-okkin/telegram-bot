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
  return gemini.chat(messages, tizim);
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
  if (/^\/miya_gemini$/i.test(t)) {
    saqla({ tur: 'gemini' });
    await tg.sendMessage(chatId, '🧠 Miya: Google Gemini ga qaytarildi.');
    return true;
  }
  if (/^\/miya_ulash\b/i.test(t)) {
    const [nom, url, model, kalit] = t.replace(/^\/miya_ulash\s*/i, '').split('|').map((x) => (x || '').trim());
    if (!nom || !/^https?:\/\//.test(url || '') || !model) {
      await tg.sendMessage(chatId, "Format: /miya_ulash Nomi | https://manzil/v1 | model | kalit\nMisol: /miya_ulash Bizning AI | https://ai.inok.uz/v1 | asad-1 | sk-...");
      return true;
    }
    const s = { tur: 'openai', nomi: nom, url, model, kalit: kalit || '' };
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
