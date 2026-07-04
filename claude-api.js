/* Anthropic Claude API ustidan yupqa qatlam - faqat HTTP chaqiruv, biznes-mantiq yo'q.
bot.js shu modulni suhbat (AI yordamchi) uchun ishlatadi. telegram-api.js va moderator.js
dagi groqChat bilan bir xil uslubda - qo'shimcha npm paketsiz, xom https moduli orqali. */
const https = require('https');

const API_KEY = process.env.PM_ANTHROPIC_API_KEY;
const MODEL = 'claude-opus-4-8';

function chat(messages, system) {
  return new Promise((resolve, reject) => {
    if (!API_KEY) { reject(new Error("PM_ANTHROPIC_API_KEY o'rnatilmagan")); return; }
    const body = JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system,
      messages,
    });
    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (parsed.error) { reject(new Error(parsed.error.message || 'Claude API xato')); return; }
            const textBlock = (parsed.content || []).find((b) => b.type === 'text');
            resolve(textBlock ? textBlock.text : '');
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