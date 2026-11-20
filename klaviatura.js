/* ⌨️ Sof Özbek klaviatura — APK'ni Telegram orqali tarqatish va yangilash.
   - Admin: «⌨️ Klaviatura» tugmasi yoki /klaviatura -> oxirgi versiya APK fayli.
   - Har kim (shaxsiy chatda): /start yoki /klaviatura -> APK + obuna bo'ladi.
   - Har 30 daqiqada GitHub relizini tekshiradi (reliz.js keshi orqali); yangi versiya chiqsa
     adminga va barcha obunachilarga APK avtomatik yuboriladi.
   Telefon ilovasi ham shu relizni https://inok.uz/claude-pc/reliz/sof-ozbek-klaviatura orqali tekshiradi. */
const fs = require('fs');
const path = require('path');
const https = require('https');
const tg = require('./telegram-api');
const { reliz } = require('./reliz');

const REPO = 'sof-ozbek-klaviatura';
const TUGMA = '⌨️ Klaviatura';
const FAYL = path.join(__dirname, 'data', 'klaviatura.json'); // {tag, fileId, fileTag, obunachilar: []}

function oqi() {
  try { return JSON.parse(fs.readFileSync(FAYL, 'utf8')); } catch { return { obunachilar: [] }; }
}

function yoz(d) {
  try { fs.mkdirSync(path.dirname(FAYL), { recursive: true }); fs.writeFileSync(FAYL, JSON.stringify(d, null, 2)); } catch (e) {
    console.error('klaviatura.json:', e.message);
  }
}

async function oxirgi() {
  const r = JSON.parse(await reliz(REPO));
  const a = (r.assets || []).find((x) => /\.apk$/i.test(x.name || ''));
  return { tag: r.tag_name, nom: r.name, izoh: r.body || '', url: a && a.browser_download_url, fayl: (a && a.name) || 'SofOzbekKlaviatura.apk' };
}

function yuklab(url, qadam = 0) {
  return new Promise((resolve, reject) => {
    if (qadam > 5) return reject(new Error("juda ko'p yo'naltirish"));
    https.get(url, { headers: { 'User-Agent': 'claude-asadbek-bot' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(yuklab(res.headers.location, qadam + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`yuklab olish ${res.statusCode}`)); }
      const b = [];
      res.on('data', (c) => b.push(c));
      res.on('end', () => resolve(Buffer.concat(b)));
    }).on('error', reject);
  });
}

function hujjatYubor(chatId, buf, faylNomi, caption) {
  return new Promise((resolve, reject) => {
    const ch = '----klaviatura' + Date.now();
    const qism = (nom, qiymat) => `--${ch}\r\nContent-Disposition: form-data; name="${nom}"\r\n\r\n${qiymat}\r\n`;
    const bosh = Buffer.from(
      qism('chat_id', chatId) + qism('caption', caption) +
      `--${ch}\r\nContent-Disposition: form-data; name="document"; filename="${faylNomi}"\r\n` +
      'Content-Type: application/vnd.android.package-archive\r\n\r\n', 'utf8');
    const oxir = Buffer.from(`\r\n--${ch}--\r\n`, 'utf8');
    const tana = Buffer.concat([bosh, buf, oxir]);
    const req = https.request({
      hostname: 'api.telegram.org', path: `/bot${tg.TOKEN}/sendDocument`, method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${ch}`, 'Content-Length': tana.length },
    }, (res) => {
      const b = [];
      res.on('data', (c) => b.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(b).toString('utf8'))); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.end(tana);
  });
}

function izoh(r, sarlavha) {
  return `${sarlavha ? sarlavha + '\n\n' : ''}⌨️ Sof Özbek klaviatura ${r.tag}\n` +
    "2026-yilgi yangi alifbo: Ö Ş Ç Ğ, so'z takliflari, ovozli yozish, kirill/eski lotinni o'girish.\n\n" +
    "O'rnatish: faylni bosing → «O'rnatish». Keyin ilovani ochib 1- va 2-qadamni bajaring.\n" +
    'Yangi versiyalar ilovaning o\'zida va shu bot orqali keladi.';
}

async function yubor(chatId, r, sarlavha) {
  r = r || (await oxirgi());
  if (!r.url) throw new Error('relizda APK yo\'q');
  const d = oqi();
  const caption = izoh(r, sarlavha);
  if (d.fileId && d.fileTag === r.tag) {
    const res = await tg.apiCall('sendDocument', { chat_id: chatId, document: d.fileId, caption });
    if (res && res.ok) return true;
  }
  const buf = await yuklab(r.url);
  const res = await hujjatYubor(chatId, buf, r.fayl, caption);
  if (res && res.ok && res.result && res.result.document) {
    const d2 = oqi();
    d2.fileId = res.result.document.file_id;
    d2.fileTag = r.tag;
    yoz(d2);
    return true;
  }
  throw new Error((res && res.description) || 'sendDocument xato');
}

/** Admin chat: «⌨️ Klaviatura» yoki /klaviatura */
async function handleText(chatId, text) {
  if (text !== TUGMA && !/^\/klaviatura\b/.test(text || '')) return false;
  try {
    await tg.sendMessage(chatId, '⏳ APK tayyorlanmoqda...');
    await yubor(chatId);
  } catch (e) {
    await tg.sendMessage(chatId, `⌨️ APK yuborib bo'lmadi: ${e.message}`);
  }
  return true;
}

/** Boshqa odamlar (do'stlar) shaxsiy chatda: /start yoki /klaviatura -> APK + obuna. */
async function begona(message) {
  const text = message.text || '';
  if (!/^\/(start|klaviatura)\b/.test(text)) return false;
  const id = String(message.chat.id);
  const d = oqi();
  d.obunachilar = d.obunachilar || [];
  if (!d.obunachilar.includes(id)) { d.obunachilar.push(id); yoz(d); }
  try {
    await yubor(id);
  } catch (e) {
    console.error('klaviatura begona:', e.message);
    await tg.sendMessage(id, "Kechirasiz, hozir APK'ni yuborib bo'lmadi. Birozdan keyin /klaviatura deb yozing.");
  }
  return true;
}

let ADMIN = null;

async function tekshir() {
  let r;
  try { r = await oxirgi(); } catch (e) { return; }
  if (!r.tag || !r.url) return;
  const d = oqi();
  if (!d.tag) { d.tag = r.tag; yoz(d); return; }
  if (d.tag === r.tag) return;
  d.tag = r.tag;
  yoz(d);
  const kimlar = [ADMIN, ...(d.obunachilar || [])].filter(Boolean);
  for (const id of [...new Set(kimlar)]) {
    try { await yubor(id, r, '🆕 Yangi versiya chiqdi!'); } catch (e) { console.error('klaviatura yangi versiya', id, e.message); }
    await new Promise((res) => setTimeout(res, 300));
  }
}

function start(adminChatId) {
  ADMIN = adminChatId;
  setTimeout(tekshir, 60 * 1000);
  setInterval(tekshir, 30 * 60 * 1000);
}

module.exports = { TUGMA, handleText, begona, start };
