/* Bazis faylini shifrdan yechish: .b3d yuborilsa, shu serverdagi Bazis Usta AI ga (127.0.0.1:8395) beriladi.
Bazis Usta foydalanuvchining Bazis kompyuterida faylni ochadi, shifr kalitini (botda saqlangan parol bilan)
o'chirib shifrsiz saqlaydi va natijani SHU bot orqali qaytaradi. Parol bu botda saqlanmaydi. */
const https = require('https');
const http = require('http');
const tg = require('./telegram-api');

const API = process.env.BAZIS_USTA_API || 'http://127.0.0.1:8395';
const KALIT = process.env.BAZIS_USTA_ICHKI_KALIT || '';

function yuklab(fileId) {
  return tg.apiCall('getFile', { file_id: fileId }).then((r) => new Promise((resolve, reject) => {
    if (!r || !r.ok) return reject(new Error('getFile xato'));
    https.get(`https://api.telegram.org/file/bot${tg.TOKEN}/${r.result.file_path}`, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  }));
}

function yubor(chatId, faylNomi, buf) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ chat: chatId, fayl_nomi: faylNomi, fayl_b64: buf.toString('base64') });
    const u = new URL(API + '/api/ichki/shifr');
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-Ichki': KALIT } }, (res) => {
      let s = '';
      res.on('data', (c) => (s += c));
      res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.end(body);
  });
}

// true - xabar shu modulda ko'rib chiqildi
async function handleDocument(chatId, message) {
  const doc = message.document;
  if (!doc || !/\.b3d$/i.test(doc.file_name || '')) return false;
  if (!KALIT) {
    await tg.sendMessage(chatId, "Bazis Usta bilan bog'lanish sozlanmagan (BAZIS_USTA_ICHKI_KALIT).");
    return true;
  }
  try {
    const buf = await yuklab(doc.file_id);
    const r = await yubor(chatId, doc.file_name, buf);
    if (r && r.ok) await tg.sendMessage(chatId, `🔓 ${doc.file_name} shifrdan yechilmoqda (Bazis kompyuterida)... Tayyor fayl shu yerga keladi.`);
    else await tg.sendMessage(chatId, `⚠️ Yuborilmadi: ${(r && r.xato) || 'Bazis Usta javob bermadi'}`);
  } catch (e) {
    await tg.sendMessage(chatId, `⚠️ Shifrdan yechishga yuborib bo'lmadi: ${e.message}`);
  }
  return true;
}

module.exports = { handleDocument };
