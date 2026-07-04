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
    parts: [{ text: m.content }],
  }));
}

function chat(messages, systemInstruction) {
  return new Promise((resolve, reject) => {
    if (!API_KEY) { reject(new Error("PM_GEMINI_API_KEY o'rnatilmagan")); return; }
    const body = JSON.stringify({
      system_instruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
      contents: toGeminiContents(messages),
    });
    const req = https.request(
      {
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
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
            if (parsed.error) { reject(new Error(parsed.error.message || 'Gemini API xato')); return; }
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

module.exports = { API_KEY, chat };