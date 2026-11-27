/* Google Gemini API ustidan yupqa qatlam - faqat HTTP chaqiruv, biznes-mantiq yo'q.
Claude API bepul balans hal bo'lgunga qadar bot shu provayderdan foydalanadi (bepul kalit,
karta shart emas - aistudio.google.com/apikey). bot.js conversation formatini (role: user/
assistant, content: matn) Gemini formatiga (role: user/model, parts: [{text}]) o'zi o'giradi. */
const https = require('https');

const API_KEY = process.env.PM_GEMINI_API_KEY;
const MODEL = process.env.PM_GEMINI_MODEL || 'gemini-2.5-flash';

function toGeminiContents(messages) {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: m.parts || [{ text: m.content }], // m.parts - rasm kabi tayyor qismlar (rasmSavol)
  }));
}

// Har bir Gemini modelining bepul limiti ALOHIDA: biri tugasa (429) yoki yo'q bo'lsa (404) keyingisiga o'tamiz.
// Hammasi tugasa - xato.kvota = true (miya.js egasini ogohlantiradi).
const MODELLAR = [...new Set([MODEL, ...(process.env.PM_GEMINI_MODELS
  || 'gemini-3-flash-preview,gemini-3.1-flash-lite-preview,gemini-2.5-flash,gemini-2.5-flash-lite').split(',').map((x) => x.trim()).filter(Boolean)])];
const chetda = {}; // model -> shu vaqtgacha ishlatilmaydi (limit tugagan)

async function chat(messages, systemInstruction) {
  let oxirgi = null;
  let kvota = 0;
  for (const m of MODELLAR) {
    if ((chetda[m] || 0) > Date.now()) { kvota += 1; continue; }
    try {
      return await chatModel(m, messages, systemInstruction);
    } catch (e) {
      oxirgi = e;
      if (e.kod === 429) { chetda[m] = Date.now() + 30 * 60 * 1000; kvota += 1; continue; }
      if (e.kod === 404) { chetda[m] = Date.now() + 24 * 3600 * 1000; continue; }
      if (e.kod >= 500) continue;
      throw e;
    }
  }
  const x = oxirgi || new Error('Gemini: hech bir model ishlamadi');
  if (kvota) x.kvota = true;
  throw x;
}

function chatModel(model, messages, systemInstruction) {
  return new Promise((resolve, reject) => {
    if (!API_KEY) { reject(new Error("PM_GEMINI_API_KEY o'rnatilmagan")); return; }
    const body = JSON.stringify({
      system_instruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
      contents: toGeminiContents(messages),
    });
    const req = https.request(
      {
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/${model}:generateContent?key=${API_KEY}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (parsed.error) {
              const e = new Error(parsed.error.message || 'Gemini API xato');
              e.kod = parsed.error.code || res.statusCode;
              reject(e);
              return;
            }
            const candidate = (parsed.candidates || [])[0];
            const text = candidate && candidate.content && candidate.content.parts
              ? candidate.content.parts.map((p) => p.text || '').join('')
              : '';
            resolve(text);
          } catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Ovozli xabarni matnga aylantirish (Telegram voice: audio/ogg). Faqat aytilgan matnni qaytaradi.
function transkript(audioBuffer, mime) {
  return new Promise((resolve, reject) => {
    if (!API_KEY) { reject(new Error("PM_GEMINI_API_KEY o'rnatilmagan")); return; }
    const body = JSON.stringify({
      contents: [{ role: 'user', parts: [
        { inline_data: { mime_type: mime || 'audio/ogg', data: audioBuffer.toString('base64') } },
        { text: "Bu ovozli xabarni so'zma-so'z matnga aylantir (asosan o'zbek tilida, rus/ingliz so'zlar aralashishi mumkin). Faqat aytilgan matnni qaytar, izoh qo'shma. Hech narsa eshitilmasa bo'sh qaytar." },
      ] }],
    });
    const req = https.request(
      {
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const p = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (p.error) { reject(new Error(p.error.message || 'Gemini API xato')); return; }
            const c = (p.candidates || [])[0];
            resolve(c && c.content && c.content.parts ? c.content.parts.map((x) => x.text || '').join('').trim() : '');
          } catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// 🖼 Rasmga qarab savolga javob (skrinshot tahlili) - bepul modellar navbati bilan
function rasmSavol(buf, mime, savol, tizim) {
  return chat([{ role: 'user', parts: [{ inline_data: { mime_type: mime || 'image/jpeg', data: buf.toString('base64') } }, { text: savol }] }], tizim);
}

module.exports = { API_KEY, chat, transkript, rasmSavol };