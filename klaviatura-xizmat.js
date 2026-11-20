/* ⌨️ Sof Özbek klaviatura — foydalanuvchilardan fikr va yangi so'zlarni yig'ish (faqat server, kompyuterga bog'liq emas).

   Telefon ilovasi (https://inok.uz/claude-pc/klaviatura/...):
     POST /klaviatura/sozlar {q, v, s:[...]}            lug'atda yo'q, telefonda kamida 3 marta yozilgan so'zlar
     POST /klaviatura/fikr   {q, v, a, tur, matn}       fikr ('fikr') yoki ilova xatosi ('xato') -> darhol adminga
     GET  /klaviatura/lugat  -> {versiya, sozlar:[...]}  tasdiqlangan qo'shimcha so'zlar (ilova kuniga 1 marta oladi)
   q - anonim qurilma raqami (ilova o'zi yasaydi), hech qanday shaxsiy ma'lumot yo'q.

   Har 4 kunda ("4 kunlik reja"): kamida 3 xil qurilmada yozilgan so'zlar lug'atga qo'shiladi (versiya+1),
   adminga hisobot: nechta foydalanuvchi, qo'shilgan so'zlar, nomzodlar, kelgan fikrlar.
   Admin buyruqlari: /klaviatura_hisobot - hozir hisobot va lug'atni yangilash; /lugat_ochir so'z - so'zni olib tashlash. */
const fs = require('fs');
const path = require('path');
const tg = require('./telegram-api');

const YIGIM = path.join(__dirname, 'data', 'klaviatura-yigim.json');
const LUGAT = path.join(__dirname, 'data', 'klaviatura-lugat.json');
const REJA_MS = 4 * 24 * 60 * 60 * 1000;
const KAMIDA_QURILMA = 3;
const SOZ_RE = /^[a-zöğşçʼ]{3,20}$/;
const Q_RE = /^[a-zA-Z0-9-]{8,40}$/;

let ADMIN = null;

function oqi(f, def) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; }
}

function yoz(f, d) {
  try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(d)); } catch (e) {
    console.error('klaviatura-xizmat yozish:', e.message);
  }
}

let yigim = null;
let lugat = null;
function yuklash() {
  if (!yigim) yigim = oqi(YIGIM, { sozlar: {}, qurilmalar: {}, fikrlar: [], oxirgiReja: Date.now() });
  if (!lugat) lugat = oqi(LUGAT, { versiya: 0, sozlar: [], qora: [] });
}

let saqlashTaymer = null;
function saqla() {
  if (saqlashTaymer) return;
  saqlashTaymer = setTimeout(() => { saqlashTaymer = null; yoz(YIGIM, yigim); }, 5000);
}

// ---------- himoya: IP bo'yicha soatiga 40 so'rov ----------
const ipHisob = new Map();
function ruxsatmi(req) {
  const ip = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0];
  const soat = Math.floor(Date.now() / 3600000);
  const k = ip + '|' + soat;
  const n = (ipHisob.get(k) || 0) + 1;
  ipHisob.set(k, n);
  if (ipHisob.size > 5000) ipHisob.clear();
  return n <= 40;
}

function tanaOl(req, max) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > max) { req.destroy(); resolve(null); } });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

function json(res, kod, obj) {
  res.writeHead(kod, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const xatoEslatildi = new Map(); // bir xil xato kuniga 1 marta

// ---------- qurilma joylashuvi (IP saqlanmaydi, faqat davlat/viloyat) ----------
const geoKesh = new Map();
let geoDaqiqa = 0;
let geoSoni = 0;
function ipOl(req) {
  return String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}
function geoAniqla(ip) {
  return new Promise((resolve) => {
    if (!ip || /^(127\.|10\.|192\.168\.|::1)/.test(ip)) return resolve(null);
    if (geoKesh.has(ip)) return resolve(geoKesh.get(ip));
    const daq = Math.floor(Date.now() / 60000);
    if (daq !== geoDaqiqa) { geoDaqiqa = daq; geoSoni = 0; }
    if (++geoSoni > 40) return resolve(null); // ip-api.com: daqiqasiga 45 so'rov
    require('http').get(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,regionName,city`, (r) => {
      let s = '';
      r.on('data', (c) => { s += c; });
      r.on('end', () => {
        try {
          const g = JSON.parse(s);
          const natija = g.status === 'success' ? { davlat: g.country, kod: g.countryCode, viloyat: g.regionName, shahar: g.city } : null;
          geoKesh.set(ip, natija);
          if (geoKesh.size > 20000) geoKesh.clear();
          resolve(natija);
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

function qurilmaBelgila(req, q, v, a) {
  const eski = yigim.qurilmalar[q] || { birinchi: Date.now() };
  yigim.qurilmalar[q] = { ...eski, vaqt: Date.now(), v: String(v || eski.v || '').slice(0, 20), a: String(a || eski.a || '').slice(0, 40) };
  if (!eski.davlat) {
    geoAniqla(ipOl(req)).then((g) => { if (g && yigim.qurilmalar[q]) { Object.assign(yigim.qurilmalar[q], g); saqla(); } });
  }
}

// ---------- ovozni matnga aylantirish (Gemini) ----------
const ovozKunlik = new Map(); // qurilma|kun -> soni
function ovozMatni(audio, til) {
  return new Promise((resolve, reject) => {
    const kalit = process.env.PM_GEMINI_API_KEY;
    if (!kalit) return reject(new Error("Gemini kaliti yo'q"));
    const model = process.env.PM_GEMINI_MODEL || 'gemini-2.5-flash';
    const korsatma = til === 'ru' ? 'Транскрибируй это аудио дословно на русском. Верни только текст.'
      : til === 'en' ? 'Transcribe this audio verbatim in English. Return only the text.'
        : "Bu ovozni so'zma-so'z o'zbek tilida matnga aylantir. Sof o'zbek adabiy imlosida, lotin yozuvida yoz " +
          "(o', g', sh, ch harflari bilan; tinish belgilarini qo'y). Faqat aytilgan matnni qaytar, izoh yozma. " +
          "Hech narsa eshitilmasa bo'sh qaytar.";
    const body = JSON.stringify({ contents: [{ role: 'user', parts: [
      { inline_data: { mime_type: 'audio/aac', data: audio.toString('base64') } }, { text: korsatma }] }] });
    const r = require('https').request({
      hostname: 'generativelanguage.googleapis.com', path: `/v1beta/models/${model}:generateContent?key=${kalit}`,
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 35000,
    }, (rs) => {
      const b = [];
      rs.on('data', (c) => b.push(c));
      rs.on('end', () => {
        try {
          const p = JSON.parse(Buffer.concat(b).toString('utf8'));
          if (p.error) return reject(new Error(p.error.message || 'Gemini xato'));
          const c = (p.candidates || [])[0];
          resolve(c && c.content && c.content.parts ? c.content.parts.map((x) => x.text || '').join('').trim() : '');
        } catch (e) { reject(e); }
      });
    });
    r.on('timeout', () => r.destroy(new Error('vaqt tugadi')));
    r.on('error', reject);
    r.end(body);
  });
}

function ovozQabul(req, res) {
  const q = String(req.headers['x-q'] || '');
  if (!Q_RE.test(q)) return json(res, 400, { xato: "noto'g'ri so'rov" });
  const kun = `${q}|${new Date().toISOString().slice(0, 10)}`;
  const n = (ovozKunlik.get(kun) || 0) + 1;
  ovozKunlik.set(kun, n);
  if (ovozKunlik.size > 50000) ovozKunlik.clear();
  if (n > 150) return json(res, 429, { xato: 'kunlik chegara' });
  const b = [];
  let hajm = 0;
  req.on('data', (c) => { hajm += c.length; if (hajm > 2 * 1024 * 1024) { req.destroy(); return; } b.push(c); });
  req.on('end', () => {
    if (hajm < 500) return json(res, 400, { xato: 'ovoz juda qisqa' });
    qurilmaBelgila(req, q, req.headers['x-v'], null);
    const til = ['uz', 'ru', 'en'].includes(req.headers['x-til']) ? req.headers['x-til'] : 'uz';
    ovozMatni(Buffer.concat(b), til)
      .then((matn) => { yigim.ovozSoni = (yigim.ovozSoni || 0) + 1; saqla(); json(res, 200, { matn }); })
      .catch((e) => { console.error('klaviatura ovoz:', e.message); json(res, 502, { xato: 'tanib bolmadi' }); });
  });
}

// ---------- admin ilovasi uchun (kalit bilan) ----------
const ADMIN_KALIT_FAYL = path.join(__dirname, 'data', 'klaviatura-admin-kalit.txt');
function adminKalit() {
  try { return fs.readFileSync(ADMIN_KALIT_FAYL, 'utf8').trim(); } catch {
    const k = require('crypto').randomBytes(24).toString('hex');
    fs.mkdirSync(path.dirname(ADMIN_KALIT_FAYL), { recursive: true });
    fs.writeFileSync(ADMIN_KALIT_FAYL, k, { mode: 0o600 });
    return k;
  }
}
const adminXato = new Map(); // ip|soat -> noto'g'ri urinishlar
function adminmi(req) {
  const ip = ipOl(req);
  const k = `${ip}|${Math.floor(Date.now() / 3600000)}`;
  if ((adminXato.get(k) || 0) >= 10) return null; // soatiga 10 ta noto'g'ri urinishdan keyin bloklanadi
  const a = Buffer.from(String(req.headers['x-admin-kalit'] || ''));
  const b = Buffer.from(adminKalit());
  const ok = a.length === b.length && require('crypto').timingSafeEqual(a, b);
  if (!ok) { adminXato.set(k, (adminXato.get(k) || 0) + 1); if (adminXato.size > 5000) adminXato.clear(); }
  return ok;
}

function sanaq(royxat, kalitFn) {
  const m = {};
  for (const x of royxat) { const k = kalitFn(x) || "Noma'lum"; m[k] = (m[k] || 0) + 1; }
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

function statistika() {
  const hozir = Date.now();
  const KUN = 86400000;
  const q = Object.values(yigim.qurilmalar);
  const faol = (k) => q.filter((x) => hozir - x.vaqt < k * KUN).length;
  const kunlik = [];
  for (let i = 29; i >= 0; i--) {
    const bosh = new Date(hozir - i * KUN).toISOString().slice(0, 10);
    kunlik.push([bosh, q.filter((x) => x.birinchi && new Date(x.birinchi).toISOString().slice(0, 10) === bosh).length]); // yangi o'rnatganlar
  }
  const nomzod = Object.entries(yigim.sozlar).map(([s, e]) => [s, e.q.length]).sort((a, b) => b[1] - a[1]).slice(0, 150);
  return {
    vaqt: hozir,
    jami: q.length, bugun: faol(1), hafta: faol(7), oy: faol(30),
    ovozSoni: yigim.ovozSoni || 0,
    kunlik,
    davlatlar: sanaq(q, (x) => x.davlat),
    viloyatlar: sanaq(q, (x) => (x.davlat ? `${x.davlat} — ${x.viloyat || '?'}` : null)),
    shaharlar: sanaq(q, (x) => (x.shahar ? `${x.shahar} (${x.kod || '?'})` : null)).slice(0, 50),
    versiyalar: sanaq(q.filter((x) => hozir - x.vaqt < 30 * KUN), (x) => x.v),
    telefonlar: sanaq(q, (x) => x.a).slice(0, 30),
    fikrlar: yigim.fikrlar.filter((f) => f.tur === 'fikr').slice(-200).reverse(),
    xatolar: yigim.fikrlar.filter((f) => f.tur === 'xato').slice(-40).reverse(),
    lugat: { versiya: lugat.versiya, soni: lugat.sozlar.length, oxirgilar: lugat.sozlar.slice(-100).reverse() },
    nomzodlar: nomzod,
    keyingiReja: (yigim.oxirgiReja || 0) + REJA_MS,
  };
}

function adminHttp(req, res, yol) {
  const ok = adminmi(req);
  if (ok === null) return json(res, 429, { xato: "ko'p noto'g'ri urinish, 1 soatdan keyin" });
  if (!ok) return json(res, 403, { xato: "kalit noto'g'ri" });
  if (yol === 'admin/statistika' && req.method === 'GET') return json(res, 200, statistika());
  if (yol === 'admin/ochir' && req.method === 'POST') {
    return tanaOl(req, 2000).then((b) => {
      const s = String((b && b.soz) || '').toLowerCase();
      if (!SOZ_RE.test(s)) return json(res, 400, { xato: "noto'g'ri so'z" });
      sozniOchir(s);
      return json(res, 200, { ok: true });
    });
  }
  if (yol === 'admin/reja' && req.method === 'POST') { reja(true).catch(() => {}); return json(res, 200, { ok: true }); }
  return json(res, 404, { xato: "yo'q" });
}

function sozniOchir(s) {
  lugat.sozlar = lugat.sozlar.filter((x) => x !== s);
  if (!lugat.qora.includes(s)) lugat.qora.push(s);
  lugat.versiya += 1;
  yoz(LUGAT, lugat);
  delete yigim.sozlar[s];
  saqla();
}

function handleHttp(req, res) {
  const url = req.url.split('?')[0].replace(/\/+$/, '');
  const m = url.match(/\/klaviatura\/(sozlar|fikr|lugat|ovoz|admin\/[a-z]+)$/);
  if (!m) return false;
  yuklash();
  if (m[1].startsWith('admin/')) { adminHttp(req, res, m[1]); return true; }
  if (m[1] === 'lugat' && req.method === 'GET') {
    json(res, 200, { versiya: lugat.versiya, sozlar: lugat.sozlar });
    return true;
  }
  if (req.method !== 'POST') { res.writeHead(405); res.end(); return true; }
  if (m[1] === 'ovoz') { ovozQabul(req, res); return true; }
  if (!ruxsatmi(req)) { json(res, 429, { xato: "ko'p so'rov" }); return true; }
  const max = m[1] === 'fikr' ? 8000 : 20000;
  tanaOl(req, max).then((b) => {
    if (!b || !Q_RE.test(String(b.q || ''))) return json(res, 400, { xato: "noto'g'ri so'rov" });
    const q = String(b.q);
    qurilmaBelgila(req, q, b.v, b.a);
    if (m[1] === 'sozlar') {
      const sozlar = Array.isArray(b.s) ? b.s.slice(0, 300) : [];
      const qora = new Set(lugat.qora);
      const bor = new Set(lugat.sozlar);
      for (const x of sozlar) {
        const s = String(x || '').toLowerCase();
        if (!SOZ_RE.test(s) || qora.has(s) || bor.has(s)) continue;
        const e = yigim.sozlar[s] || (yigim.sozlar[s] = { q: [] });
        if (!e.q.includes(q) && e.q.length < 50) e.q.push(q);
      }
      saqla();
      return json(res, 200, { ok: true });
    }
    // fikr / xato
    const tur = b.tur === 'xato' ? 'xato' : 'fikr';
    const matn = String(b.matn || '').trim().slice(0, 3500);
    if (!matn) return json(res, 400, { xato: "bo'sh" });
    yigim.fikrlar.push({ vaqt: Date.now(), tur, v: String(b.v || '').slice(0, 20), a: String(b.a || '').slice(0, 40), matn: matn.slice(0, 1500) });
    if (yigim.fikrlar.length > 500) yigim.fikrlar = yigim.fikrlar.slice(-500);
    saqla();
    json(res, 200, { ok: true });
    if (ADMIN) {
      if (tur === 'xato') {
        const kalit = matn.split('\n').slice(0, 3).join('|');
        const oldin = xatoEslatildi.get(kalit);
        if (oldin && Date.now() - oldin < 24 * 3600 * 1000) return;
        xatoEslatildi.set(kalit, Date.now());
        tg.sendMessage(ADMIN, `🐞 Klaviatura xatosi (v${b.v || '?'}, ${b.a || 'Android ?'})\n\n${matn.slice(0, 1500)}`).catch(() => {});
      } else {
        tg.sendMessage(ADMIN, `💬 Klaviatura haqida fikr (v${b.v || '?'})\n\n${matn}`).catch(() => {});
      }
    }
    return undefined;
  });
  return true;
}

/** 4 kunlik reja: so'zlarni tasdiqlash va hisobot. */
async function reja(qolda) {
  yuklash();
  const hozir = Date.now();
  const oldingi = yigim.oxirgiReja || 0;
  const qora = new Set(lugat.qora);
  const bor = new Set(lugat.sozlar);
  const yangi = [];
  const nomzod = [];
  for (const [s, e] of Object.entries(yigim.sozlar)) {
    if (qora.has(s) || bor.has(s)) { delete yigim.sozlar[s]; continue; }
    if (e.q.length >= KAMIDA_QURILMA) { yangi.push(s); delete yigim.sozlar[s]; } else nomzod.push([s, e.q.length]);
  }
  if (yangi.length) {
    lugat.sozlar.push(...yangi.sort());
    lugat.versiya += 1;
    yoz(LUGAT, lugat);
  }
  const faol = Object.values(yigim.qurilmalar).filter((x) => hozir - x.vaqt < REJA_MS).length;
  const jami = Object.keys(yigim.qurilmalar).length;
  const versiyalar = {};
  for (const x of Object.values(yigim.qurilmalar)) if (hozir - x.vaqt < REJA_MS) versiyalar[x.v] = (versiyalar[x.v] || 0) + 1;
  const fikrlar = yigim.fikrlar.filter((f) => f.vaqt > oldingi);
  yigim.oxirgiReja = hozir;
  yoz(YIGIM, yigim);

  nomzod.sort((a, b) => b[1] - a[1]);
  let t = `⌨️ Klaviatura — ${qolda ? 'hisobot' : '4 kunlik reja'}\n\n`;
  t += `👥 Faol foydalanuvchilar (4 kun): ${faol} (jami ${jami})\n`;
  if (Object.keys(versiyalar).length) t += `📱 Versiyalar: ${Object.entries(versiyalar).map(([v, n]) => `${v || '?'}: ${n}`).join(', ')}\n`;
  t += `\n📚 Lug'atga qo'shildi: ${yangi.length} ta so'z (lug'at qo'shimchasi v${lugat.versiya}, jami ${lugat.sozlar.length})\n`;
  if (yangi.length) t += yangi.slice(0, 60).join(', ') + (yangi.length > 60 ? ' ...' : '') + '\n';
  if (nomzod.length) t += `\n⏳ Nomzodlar (${KAMIDA_QURILMA} ta qurilmaga yetmagan): ${nomzod.slice(0, 25).map(([s, n]) => `${s}(${n})`).join(', ')}\n`;
  const oddiy = fikrlar.filter((f) => f.tur === 'fikr');
  const xatolar = fikrlar.filter((f) => f.tur === 'xato');
  t += `\n💬 Fikrlar: ${oddiy.length}, 🐞 xatolar: ${xatolar.length}\n`;
  for (const f of oddiy.slice(-15)) t += `• ${f.matn.slice(0, 200)}\n`;
  t += "\nYangi so'zlar telefonlarga 1 kun ichida o'zi yetib boradi.\nKeraksiz so'zni olib tashlash: /lugat_ochir so'z";
  if (ADMIN) {
    for (let i = 0; i < t.length; i += 3800) await tg.sendMessage(ADMIN, t.slice(i, i + 3800)).catch(() => {});
  }
}

async function handleText(chatId, text) {
  if (/^\/klaviatura_hisobot\b/.test(text || '')) { await reja(true); return true; }
  const m = (text || '').match(/^\/lugat_ochir\s+(\S+)/);
  if (m) {
    yuklash();
    const s = m[1].toLowerCase();
    sozniOchir(s);
    await tg.sendMessage(chatId, `🗑 "${s}" lug'atdan olib tashlandi va boshqa qo'shilmaydi.`);
    return true;
  }
  if (/^\/klaviatura_admin\b/.test(text || '')) {
    // admin ilovasi + kirish kaliti (faqat admin chatida ishlaydi - bot.js faqat admin matnini bu yerga beradi)
    try {
      await require('./klaviatura').faylYubor(chatId,
        'https://github.com/Asadbek-okkin/sof-ozbek-klaviatura/releases/download/admin/SofOzbekAdmin.apk',
        'SofOzbekAdmin.apk', "📊 Sof Özbek Admin — foydalanuvchilar statistikasi, joylashuv, fikrlar, lug'at.");
    } catch (e) {
      await tg.sendMessage(chatId, `Admin ilovani yuborib bo'lmadi: ${e.message}`);
    }
    await tg.sendMessage(chatId, `🔑 Admin kaliti (hech kimga bermang):\n\n${adminKalit()}\n\nIlovani ochib shu kalitni kiriting. ` +
      'Kalitni almashtirish: /klaviatura_admin_yangi_kalit');
    return true;
  }
  if (/^\/klaviatura_admin_yangi_kalit\b/.test(text || '')) {
    try { fs.unlinkSync(ADMIN_KALIT_FAYL); } catch {}
    await tg.sendMessage(chatId, `🔑 Yangi admin kaliti (eskisi endi ishlamaydi):\n\n${adminKalit()}`);
    return true;
  }
  return false;
}

function start(adminChatId) {
  ADMIN = adminChatId;
  yuklash();
  setInterval(() => {
    if (Date.now() - (yigim.oxirgiReja || 0) >= REJA_MS) reja(false).catch((e) => console.error('klaviatura reja:', e.message));
  }, 60 * 60 * 1000);
}

module.exports = { handleHttp, handleText, start };
