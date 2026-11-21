/* 📊 Claude Code limitlari: haftalik (7 kun) va 5 soatlik ishlatilgan foiz.
Manba: kompyuterdagi Claude Code status qatori (rate_limits) -> hooks/claude_telegram.py statusline ->
~/.claude/tg-sessiya/limit.json -> kuzatuvchi har 30 s serverga (holat.claude_limit).
Kirish kaliti yoki email hech qachon serverga yuborilmaydi - faqat foizlar.
Buyruq: /limit (shaxsiy chatda va botlar guruhida). Guruhga va egasiga: har 10% (10…100) ga yetganda ogohlantirish + eng ko'p sarflagan loyiha
va har kuni 09:00 dagi umumiy hisobotda. */
const fs = require('fs');
const path = require('path');
const tg = require('./telegram-api');

const FAYL = path.join(__dirname, 'data', 'claude-limit.json');
const TARIF = process.env.CLAUDE_TARIF || 'Claude Ultra';
const CHEGARALAR = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]; // har 10% da ogohlantirish

let holat = null; // {vaqt, five_hour:{foiz, tiklanadi}, seven_day:{...}, ogohlantirilgan:{}}
try { holat = JSON.parse(fs.readFileSync(FAYL, 'utf8')); } catch {}

function saqla() {
  try { fs.mkdirSync(path.dirname(FAYL), { recursive: true }); fs.writeFileSync(FAYL, JSON.stringify(holat)); } catch {}
}

function toshkent(sek) {
  if (!sek) return '';
  return new Date(sek * 1000).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function qolgan(sek) {
  if (!sek) return '';
  const d = Math.max(0, Math.round((sek * 1000 - Date.now()) / 60000));
  const kun = Math.floor(d / 1440);
  const soat = Math.floor((d % 1440) / 60);
  return kun ? `${kun} kun ${soat} soat` : soat ? `${soat} soat ${d % 60} daq` : `${d} daq`;
}

function ustun(foiz) {
  const n = Math.round(Math.min(100, Math.max(0, foiz)) / 10);
  const rang = foiz >= 90 ? '🟥' : foiz >= 75 ? '🟧' : foiz >= 50 ? '🟨' : '🟩';
  return rang.repeat(n) + '⬜'.repeat(10 - n);
}

function oyna(nomi, w) {
  if (!w || w.foiz === undefined) return `${nomi}: — (Anthropic hozircha ko'rsatmadi)`;
  const q = Math.max(0, 100 - w.foiz);
  return `${nomi}: ${w.foiz.toFixed(0)}% ishlatildi · ${q.toFixed(0)}% qoldi\n${ustun(w.foiz)}\n🔄 ${toshkent(w.tiklanadi)} da tiklanadi (${qolgan(w.tiklanadi)} qoldi)`;
}

function matn() {
  let m = `🤖━━ CLAUDE LIMITI ━━🤖\n💎 Tarif: ${TARIF}\n`;
  if (!holat || !holat.vaqt) {
    return `${m}\n⏳ Hali ma'lumot kelmagan. Kompyuterda Claude Code'da bitta xabar yozilgach paydo bo'ladi.`;
  }
  const hf = holat.seven_day ? holat.seven_day.foiz : null;
  if (hf !== null) {
    m += hf >= 90 ? '🔴 Limit tugayapti — faqat muhim ishlar!\n'
      : hf >= 75 ? '🟠 Limit kam qoldi — tejab ishlating\n'
        : hf >= 50 ? '🟡 Yarmidan oshdi — me\'yorida ishlating\n'
          : '🟢 Limit yetarli — bemalol ishlash mumkin\n';
  }
  m += `\n${oyna('📅 Haftalik (7 kun)', holat.seven_day)}\n\n${oyna('⏱ 5 soatlik', holat.five_hour)}`;
  if (holat.loyihalar && holat.loyihalar.length) {
    m += `\n\n🏗 Bu hafta qaysi loyiha qancha sarfladi:${holat.loyihalar.map((x, i) => `\n${['🥇', '🥈', '🥉'][i] || '•'} ${x.loyiha} — ${x.ulush.toFixed(0)}%`).join('')}`;
  }
  const daq = Math.round((Date.now() / 1000 - holat.vaqt) / 60);
  m += `\n\n🕒 Yangilangan: ${daq < 2 ? 'hozirgina' : `${daq} daq. oldin`}`;
  return m;
}

// "🤖 Claude Code" ro'yxati ostidagi bir qator
function qisqa() {
  if (!holat || !holat.vaqt) return '';
  const f = (w) => (w ? `${w.foiz.toFixed(0)}%` : '—');
  return `📊 Limit: haftalik ${f(holat.seven_day)} · 5 soatlik ${f(holat.five_hour)}`;
}

let guruhOl = () => null;
let egaChat = null;

// kuzatuvchidan: {vaqt, five_hour:{foiz,tiklanadi}, seven_day:{...}}
function keldi(l) {
  if (!l || typeof l !== 'object' || !l.vaqt) return;
  const toza = (w) => (w && Number.isFinite(Number(w.foiz)) ? { foiz: Number(w.foiz), tiklanadi: Number(w.tiklanadi) || null } : undefined);
  const eski = holat || {};
  const loyihalar = (Array.isArray(l.loyihalar) ? l.loyihalar : [])
    .filter((x) => x && x.loyiha && Number.isFinite(Number(x.ulush)))
    .slice(0, 5).map((x) => ({ loyiha: String(x.loyiha).slice(0, 60), ulush: Number(x.ulush) }));
  holat = { vaqt: Number(l.vaqt), five_hour: toza(l.five_hour), seven_day: toza(l.seven_day), loyihalar,
    ogohlantirilgan: eski.ogohlantirilgan || {}, hisobot: eski.hisobot || { daq: 60, oxirgi: 0 } };
  // haftalik chegaralar: har 10% (10, 20 … 100), har tiklanish davrida har biri bir marta.
  // Bir yo'la bir nechtasi o'tilgan bo'lsa (masalan bot o'chiq turgan) - faqat eng kattasi haqida bitta xabar.
  const w = holat.seven_day;
  if (w) {
    // tiklanish vaqti har safar 1-2 daqiqaga siljiydi (22:59 → 23:00) — davrni 6 soatga yaxlitlaymiz,
    // aks holda bot buni «yangi hafta» deb o'ylab bir xil «10% ga yetdi» xabarini qayta-qayta yuborardi
    const davr = String(Math.round((Number(w.tiklanadi) || 0) / 21600));
    const o = holat.ogohlantirilgan;
    if (o.davr !== davr) { o.davr = davr; o.chegaralar = CHEGARALAR.filter((c) => w.foiz >= c && !eski.vaqt); }
    const yangi = CHEGARALAR.filter((c) => w.foiz >= c && !o.chegaralar.includes(c));
    if (yangi.length) {
      o.chegaralar.push(...yangi);
      const c = Math.max(...yangi);
      const belgi = c >= 90 ? '🚨' : c >= 70 ? '⚠️' : c >= 50 ? '🟡' : '📊';
      let xabar = `${belgi} Claude haftalik limiti ${c}% ga yetdi: hozir ${w.foiz.toFixed(0)}% ishlatildi, ${Math.max(0, 100 - w.foiz).toFixed(0)}% qoldi.\n${ustun(w.foiz)}\n🔄 ${toshkent(w.tiklanadi)} da tiklanadi (${qolgan(w.tiklanadi)} qoldi).`;
      if (loyihalar.length) xabar += `\n\n🏗 Eng ko'p sarflagan loyiha: ${loyihalar[0].loyiha} (${loyihalar[0].ulush.toFixed(0)}%)${loyihaRoyxati(loyihalar.slice(1, 3))}`;
      const g = guruhOl();
      if (g) tg.sendMessage(g, xabar).catch(() => {});
      if (egaChat) tg.sendMessage(egaChat, xabar).catch(() => {});
    }
  }
  saqla();
}

function loyihaRoyxati(list) {
  return list.map((x) => `\n   • ${x.loyiha} — ${x.ulush.toFixed(0)}%`).join('');
}

// ⏱ Davriy hisobot guruhga: standart har 60 daqiqada; /hisobot buyrug'i bilan sozlanadi
const ORALIQLAR = [0, 30, 60, 120, 180, 360, 720];

function hisobotSozlama() {
  if (!holat) holat = {};
  if (!holat.hisobot) holat.hisobot = { daq: 60, oxirgi: 0 };
  return holat.hisobot;
}

function oraliqNomi(d) {
  return d === 0 ? "o'chirilgan" : d < 60 ? `har ${d} daqiqada` : `har ${d / 60} soatda`;
}

async function hisobotBuyruq(chatId, text) {
  const m = /^\/hisobot(?:@\w+)?(?:\s+(\d+))?\s*$/i.exec(String(text || '').trim());
  if (!m) return false;
  if (String(chatId) !== String(egaChat)) { // sozlash — faqat egasi (admin)
    await tg.sendMessage(chatId, '⏱ Hisobot oralig\'ini faqat admin sozlaydi.');
    return true;
  }
  const s = hisobotSozlama();
  if (m[1] !== undefined) {
    const d = Number(m[1]);
    if (!ORALIQLAR.includes(d)) {
      await tg.sendMessage(chatId, `Mumkin bo'lgan qiymatlar (daqiqa): ${ORALIQLAR.join(', ')}. 0 — o'chirish.`);
      return true;
    }
    s.daq = d;
    s.oxirgi = Date.now();
    saqla();
    await tg.sendMessage(chatId, `✅ Guruhga Claude limiti hisoboti: ${oraliqNomi(d)}.`);
    return true;
  }
  await tg.sendMessage(chatId, `⏱ Guruhga hisobot: ${oraliqNomi(s.daq)}.\n\nO'zgartirish:\n`
    + '/hisobot 30 — har 30 daqiqada\n/hisobot 60 — har soatda\n/hisobot 180 — har 3 soatda\n'
    + '/hisobot 360 — har 6 soatda\n/hisobot 720 — har 12 soatda\n/hisobot 0 — o\'chirish');
  return true;
}

async function handleText(chatId, text) {
  if (await hisobotBuyruq(chatId, text)) return true;
  if (!/^\/limit(@\w+)?$/i.test(String(text || '').trim()) && text !== '🤖 Claude limiti') return false;
  await tg.sendMessage(chatId, matn());
  return true;
}

function davriyTekshir() {
  try {
    const s = hisobotSozlama();
    if (!s.daq || !holat.vaqt) return;
    if (Date.now() - (s.oxirgi || 0) < s.daq * 60000) return;
    const g = guruhOl();
    if (!g) return;
    s.oxirgi = Date.now();
    saqla();
    tg.sendMessage(g, matn()).catch(() => {});
  } catch {}
}

function start(chatId, guruhFn) {
  egaChat = chatId;
  guruhOl = guruhFn;
  const s = hisobotSozlama();
  if (!s.oxirgi) { s.oxirgi = Date.now(); saqla(); } // birinchi hisobot — oraliq o'tgach (qayta ishga tushganda darrov emas)
  setInterval(davriyTekshir, 60000);
}

module.exports = { keldi, matn, qisqa, handleText, start };
