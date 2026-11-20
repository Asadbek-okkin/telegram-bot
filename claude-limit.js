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
  holat = { vaqt: Number(l.vaqt), five_hour: toza(l.five_hour), seven_day: toza(l.seven_day), loyihalar, ogohlantirilgan: eski.ogohlantirilgan || {} };
  // haftalik chegaralar: har 10% (10, 20 … 100), har tiklanish davrida har biri bir marta.
  // Bir yo'la bir nechtasi o'tilgan bo'lsa (masalan bot o'chiq turgan) - faqat eng kattasi haqida bitta xabar.
  const w = holat.seven_day;
  if (w) {
    const davr = String(w.tiklanadi || '');
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

async function handleText(chatId, text) {
  if (!/^\/limit(@\w+)?$/i.test(String(text || '').trim()) && text !== '🤖 Claude limiti') return false;
  await tg.sendMessage(chatId, matn());
  return true;
}

function start(chatId, guruhFn) {
  egaChat = chatId;
  guruhOl = guruhFn;
}

module.exports = { keldi, matn, qisqa, handleText, start };
