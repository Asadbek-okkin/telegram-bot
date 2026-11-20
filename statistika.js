/* "📊 Statistika": botda qilingan ishlar - kunlik hisob va matnli diagramma (Bugun / 7 kun / 30 kun).
Boshqa modullar har bir ish bajarilganda qayd('tur') chaqiradi; hisob data/faoliyat.json da (90 kun saqlanadi).
Kanal postlari moderator.json dagi eski "statistika" ro'yxatidan ham olinadi (qayd'dan oldingilari ham ko'rinsin). */
const fs = require('fs');
const path = require('path');
const tg = require('./telegram-api');

const FAYL = path.join(__dirname, 'data', 'faoliyat.json');
const MODERATOR_FAYL = path.join(__dirname, 'data', 'moderator.json');
const SAQLASH_KUN = 90;

const TURLAR = {
  claude_xabar: "✉️ Claude'ga yozilgan xabar",
  claude_rasm: "🖼 Claude'ga skrinshot",
  ovoz: '🎤 Ovozli xabar',
  claude_javob: '🤖 Claude javobi keldi',
  claude_ruxsat: "🔐 Ruxsat/savolga javob",
  claude_yopish: '⏹ Sessiya yopildi',
  vscode: '🧩 VS Code ochildi',
  ai_studio: '🎨 AI Studio yoqildi/o\'chirildi',
  pc_dastur: '▶ Dastur yoqildi/yopildi',
  pc_yoqish: '⚡ Kompyuter yoqildi',
  pc_ochirish: "⏻ Kompyuter o'chirildi",
  post: '📢 Kanal posti',
  goya: "💡 G'oya yozildi",
  mavzu: '🔎 Guruhdan mavzu topildi',
};

function bugunKalit(ms = Date.now()) {
  // Toshkent sanasi: YYYY-MM-DD
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' });
}

function oqi() {
  try { return JSON.parse(fs.readFileSync(FAYL, 'utf8')) || { kunlar: {} }; } catch { return { kunlar: {} }; }
}

function qayd(tur, soni = 1) {
  try {
    const d = oqi();
    d.kunlar = d.kunlar || {};
    const k = bugunKalit();
    d.kunlar[k] = d.kunlar[k] || {};
    d.kunlar[k][tur] = (d.kunlar[k][tur] || 0) + soni;
    const chegara = bugunKalit(Date.now() - SAQLASH_KUN * 86400000);
    for (const kun of Object.keys(d.kunlar)) if (kun < chegara) delete d.kunlar[kun];
    fs.mkdirSync(path.dirname(FAYL), { recursive: true });
    fs.writeFileSync(FAYL, JSON.stringify(d));
  } catch (e) {
    console.error('statistika qayd:', e.message);
  }
}

// moderator.json: [{sana: 'DD.MM.YYYY HH:MM', ...}] -> {YYYY-MM-DD: soni}
function kanalPostlari() {
  const natija = {};
  try {
    const m = JSON.parse(fs.readFileSync(MODERATOR_FAYL, 'utf8'));
    for (const p of m.statistika || []) {
      const t = String(p.sana || '').match(/^(\d{2})\.(\d{2})\.(\d{4})/);
      if (!t) continue;
      const k = `${t[3]}-${t[2]}-${t[1]}`;
      natija[k] = (natija[k] || 0) + 1;
    }
  } catch {}
  return natija;
}

function kunlarRoyxati(n) {
  const r = [];
  for (let i = n - 1; i >= 0; i--) r.push(bugunKalit(Date.now() - i * 86400000));
  return r;
}

function ustun(qiymat, eng, uzunlik = 12) {
  if (!qiymat) return '';
  return '▒'.repeat( // kulrang, shaffof ko'rinadigan blok (█ qop-qora chiqardi)
Math.max(1, Math.round((qiymat / eng) * uzunlik)));
}

function hisobot(n) {
  const d = oqi();
  const postlar = kanalPostlari();
  const kunlar = kunlarRoyxati(n);
  const jami = {};
  const kunJami = {};
  for (const k of kunlar) {
    const kun = { ...((d.kunlar || {})[k] || {}) };
    if (postlar[k]) kun.post = Math.max(kun.post || 0, postlar[k]);
    kunJami[k] = 0;
    for (const [t, v] of Object.entries(kun)) {
      jami[t] = (jami[t] || 0) + v;
      kunJami[k] += v;
    }
  }
  const nomi = n === 1 ? 'Bugun' : `Oxirgi ${n} kun`;
  const umumiy = Object.values(jami).reduce((a, b) => a + b, 0);
  let m = `📊 Statistika — ${nomi}\nJami: ${umumiy} ta ish\n`;
  const qatorlar = Object.entries(jami).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (!qatorlar.length) {
    m += '\nBu davrda hali hech narsa qilinmagan.';
  } else {
    const eng = qatorlar[0][1];
    m += '\nTurlari bo\'yicha:\n';
    for (const [t, v] of qatorlar) m += `\n${TURLAR[t] || t}: ${v}\n${ustun(v, eng)}`;
  }
  if (n > 1) {
    const eng = Math.max(1, ...Object.values(kunJami));
    m += '\n\nKunlar bo\'yicha:\n';
    const korsat = n > 14 ? kunlar.filter((k) => kunJami[k] > 0) : kunlar;
    for (const k of korsat) {
      const [, oy, kun] = k.split('-');
      m += `\n${kun}.${oy} ${ustun(kunJami[k], eng, 14)} ${kunJami[k]}`;
    }
    if (n > 14 && !korsat.length) m += '\n(bo\'sh)';
  }
  if (!(d.kunlar && Object.keys(d.kunlar).length)) m += '\n\nℹ️ Hisob shu yangilanishdan boshlandi — kanal postlaridan boshqa ishlar endi qayd qilinadi.';
  return m;
}

function tugmalar(n) {
  const b = (son, matn) => ({ text: (son === n ? '• ' : '') + matn, callback_data: `st:${son}` });
  return { inline_keyboard: [[b(1, 'Bugun'), b(7, '7 kun'), b(30, '30 kun')]] };
}

async function handleText(chatId, text) {
  if (text !== '📊 Statistika') return false;
  await tg.sendMessage(chatId, hisobot(7), { reply_markup: tugmalar(7) });
  return true;
}

async function handleCallback(cq) {
  const data = cq.data || '';
  if (!data.startsWith('st:')) return false;
  const n = [1, 7, 30].includes(Number(data.slice(3))) ? Number(data.slice(3)) : 7;
  await tg.answerCallbackQuery(cq.id);
  await tg.editMessageText(cq.message.chat.id, cq.message.message_id, hisobot(n), { reply_markup: tugmalar(n) });
  return true;
}

module.exports = { qayd, handleText, handleCallback, hisobot };
