/* ⌨️ Sof Özbek klaviatura — APK'ni Telegram orqali tarqatish va yangilash.
   - Admin: tugma yo'q (foydalanuvchi talabi) - bot yangi versiyani o'zi yuboradi; kerak bo'lsa /klaviatura.
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
  const videolar = (r.assets || []).filter((x) => /\.mp4$/i.test(x.name || '')).map((x) => ({ nom: x.name, url: x.browser_download_url }))
    .sort((x, y) => x.nom.localeCompare(y.nom));
  return { tag: r.tag_name, nom: r.name, izoh: r.body || '', url: a && a.browser_download_url, fayl: (a && a.name) || 'SofOzbekKlaviatura.apk', videolar };
}

/** O'quv videolari (relizdagi .mp4 fayllar): "1-ornatish.mp4" -> "1. Ornatish" */
async function videoYubor(chatId, r, hammasi = false) {
  r = r || (await oxirgi());
  let royxat = r.videolar || [];
  // odatda faqat bitta to'liq qo'llanma ("0-..."), /klaviatura_video_hammasi - qismlari bilan
  const toliq = royxat.filter((v) => /^0-/.test(v.nom));
  if (!hammasi && toliq.length) royxat = toliq;
  for (const v of royxat) {
    const caption = /^0-/.test(v.nom)
      ? "📹 Sof Özbek klaviatura — to'liq qo'llanma: o'rnatish, yangi harflar, so'z takliflari, ovoz, o'girish va fishkalar"
      : '📹 ' + v.nom.replace(/\.mp4$/i, '').replace(/^(\d+)-/, '$1. ').replace(/-/g, ' ');
    const d = oqi();
    d.videoIds = d.videoIds || {};
    const kalit = `${r.tag}/${v.nom}`;
    if (d.videoIds[kalit]) {
      const res = await tg.apiCall('sendVideo', { chat_id: chatId, video: d.videoIds[kalit], caption, supports_streaming: true });
      if (res && res.ok) continue;
    }
    const buf = await yuklab(v.url);
    const res = await hujjatYubor(chatId, buf, v.nom, caption, 'sendVideo', 'video', 'video/mp4');
    if (res && res.ok && res.result && res.result.video) {
      const d2 = oqi();
      d2.videoIds = d2.videoIds || {};
      d2.videoIds[kalit] = res.result.video.file_id;
      yoz(d2);
    }
  }
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

function hujjatYubor(chatId, buf, faylNomi, caption, usul = 'sendDocument', maydon = 'document', tur = 'application/vnd.android.package-archive') {
  return new Promise((resolve, reject) => {
    const ch = '----klaviatura' + Date.now();
    const qism = (nom, qiymat) => `--${ch}\r\nContent-Disposition: form-data; name="${nom}"\r\n\r\n${qiymat}\r\n`;
    const bosh = Buffer.from(
      qism('chat_id', chatId) + qism('caption', caption) + (usul === 'sendVideo' ? qism('supports_streaming', 'true') : '') +
      `--${ch}\r\nContent-Disposition: form-data; name="${maydon}"; filename="${faylNomi}"\r\n` +
      `Content-Type: ${tur}\r\n\r\n`, 'utf8');
    const oxir = Buffer.from(`\r\n--${ch}--\r\n`, 'utf8');
    const tana = Buffer.concat([bosh, buf, oxir]);
    const req = https.request({
      hostname: 'api.telegram.org', path: `/bot${tg.TOKEN}/${usul}`, method: 'POST',
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
  if (/^\/klaviatura_video/.test(text || '')) {
    try { await videoYubor(chatId, null, /hammasi/.test(text)); } catch (e) { await tg.sendMessage(chatId, `📹 Videolarni yuborib bo'lmadi: ${e.message}`); }
    return true;
  }
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
    await videoYubor(id).catch((e) => console.error('klaviatura video:', e.message)); // qisqa o'quv videolari
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
  if (d.tag === r.tag) return;
  // birinchi marta (hali hech narsa yuborilmagan) - faqat adminga; keyin - hammaga
  const birinchi = !d.tag;
  const kimlar = birinchi ? [ADMIN] : [ADMIN, ...(d.obunachilar || [])];
  d.tag = r.tag;
  yoz(d);
  if (birinchi && ADMIN) {
    // birinchi ishga tushish: admin APK va o'quv videolarini oladi
    try { await yubor(ADMIN, r, '⌨️ Klaviatura tayyor'); await videoYubor(ADMIN, r); } catch (e) { console.error('klaviatura birinchi', e.message); }
    return;
  }
  for (const id of [...new Set(kimlar.filter(Boolean))]) {
    try { await yubor(id, r, '🆕 Yangi versiya chiqdi!'); } catch (e) { console.error('klaviatura yangi versiya', id, e.message); }
    await new Promise((res) => setTimeout(res, 300));
  }
}

function start(adminChatId) {
  ADMIN = adminChatId;
  setTimeout(tekshir, 60 * 1000);
  setInterval(tekshir, 30 * 60 * 1000);
}

/** Istalgan APK'ni URL'dan yuklab, hujjat qilib yuboradi (admin ilovasi uchun). */
async function faylYubor(chatId, url, nom, caption) {
  const buf = await yuklab(url);
  const res = await hujjatYubor(chatId, buf, nom, caption);
  if (!res || !res.ok) throw new Error((res && res.description) || 'sendDocument xato');
}

/** Foydalanuvchi fikridagi skrinshotni adminga yuborish. */
async function rasmYubor(chatId, buf, caption) {
  const nom = buf[0] === 0x89 ? 'skrinshot.png' : 'skrinshot.jpg';
  const res = await hujjatYubor(chatId, buf, nom, caption, 'sendPhoto', 'photo', buf[0] === 0x89 ? 'image/png' : 'image/jpeg');
  if (!res || !res.ok) throw new Error((res && res.description) || 'sendPhoto xato');
}

module.exports = { TUGMA, handleText, begona, start, faylYubor, rasmYubor };
