/* 🤝 Botlar jamoasi: Claude Asadbek - dispetcher. Botlar guruhida (botlar.js taxtasi) egasi buyruq beradi:
  "@claude_asadbek_bot ..." , "/v ..." yoki Claude Asadbek xabariga reply.
Telegram'da botlar bir-birining xabarini ko'rmaydi, shuning uchun "suhbat" shu yerda: Claude Asadbek AI bilan
buyruqni qadamlarga bo'ladi, har qadamni o'sha botning agent eshigiga beradi (natijani bot guruhga O'Z NOMIDAN
yozadi) va natijani keyingi botga kontekst qilib uzatadi.
Agent eshigi protokoli: POST <url> {vazifa, kontekst, guruh} -> {ok, matn}. */
const http = require('http');
const tg = require('./telegram-api');
const gemini = require('./gemini-api');
const statistika = require('./statistika');

const AGENTLAR = {
  claude: { nomi: 'Claude Asadbek', ish: "jamoa boshlig'i: botlar holati, statistika, umumiy savollarga javob, rejalashtirish, xulosa" },
  avtobot: { nomi: 'Avtobot', ish: "AI yordamchi: savolga javob, post/matn yozish, tarjima, g'oya, tahlil", url: 'http://127.0.0.1:8396/agent' },
  jarvis: { nomi: 'JarvisAsadbekBot', ish: "ofis kompyuteri: ekran rasmi, ekranda nima borligi, o'qilmagan xabarlar, eslatmalar (hali ulanmagan)" },
  gps: { nomi: 'GPS_Nazoratbot', ish: "GPS kuzatuv: mashinalar, to'lovlar, obunalar (hali ulanmagan)" },
  bazis: { nomi: 'BazisUstaAIBot', ish: 'Bazis-Mebelshik: shkaf chizish, kroy, smeta (hali ulanmagan)' },
  pult: { nomi: 'Control Pult', ish: 'kompyuter boshqaruv pulti (hali ulanmagan)' },
  pultcam: { nomi: 'Pultcam', ish: 'kameralar (hali ulanmagan)' },
};

const REJA_ROLI = `Sen @claude_asadbek_bot - Telegram botlar jamoasining boshlig'i (dispetcher).
Jamoa:
${Object.entries(AGENTLAR).map(([k, a]) => `- ${k}: ${a.nomi} — ${a.ish}`).join('\n')}
Foydalanuvchi buyrug'ini qadamlarga bo'l: har qadamni eng mos botga ber. Har bot faqat o'z funksiyasini bajaradi.
"hali ulanmagan" botga qadam berma - o'rniga "javob"da ayt. Oddiy savol bo'lsa bitta claude qadami yetarli.
Faqat JSON qaytar, boshqa hech narsa yozma:
{"qadamlar":[{"bot":"avtobot","vazifa":"..."}],"izoh":"qisqa reja, o'zbekcha"}`;

let botUsername = null;
async function username() {
  if (botUsername) return botUsername;
  const r = await tg.apiCall('getMe', {}).catch(() => null);
  botUsername = r && r.ok ? r.result.username : 'claude_asadbek_bot';
  return botUsername;
}

function postJson(url, body, timeout = 120000) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', timeout,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let s = '';
      res.on('data', (c) => { s += c; });
      res.on('end', () => { try { resolve(JSON.parse(s)); } catch { resolve({ ok: false, xato: `javob o'qilmadi (${res.statusCode})` }); } });
    });
    req.on('timeout', () => req.destroy(new Error('vaqt tugadi')));
    req.on('error', (e) => resolve({ ok: false, xato: /ECONNREFUSED/.test(e.message) ? "agent eshigi yopiq (bot yangilanmagan yoki to'xtagan)" : e.message }));
    req.write(data);
    req.end();
  });
}

function jsonAjrat(matn) {
  const t = String(matn || '').replace(/```(json)?/g, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

async function claudeQadam(vazifa, kontekst, guruh, qoshimcha) {
  const prompt = `${kontekst ? `Oldingi botlar natijasi:\n${kontekst}\n\n` : ''}${qoshimcha ? `Ma'lumot:\n${qoshimcha}\n\n` : ''}Vazifa: ${vazifa}`;
  const matn = await gemini.chat([{ role: 'user', content: prompt }],
    "Sen @claude_asadbek_bot - botlar jamoasi boshlig'isan. O'zbek tilida, aniq va qisqa yoz. Markdown ishlatma.");
  await tg.sendMessage(guruh, matn || '…');
  return matn;
}

// botlarHolati: botlar.js dan (aylanma require bo'lmasligi uchun parametr)
async function bajar(guruh, buyruq, botlarHolati) {
  await tg.apiCall('sendChatAction', { chat_id: guruh, action: 'typing' }).catch(() => {});
  const rejaMatn = await gemini.chat([{ role: 'user', content: buyruq }], REJA_ROLI).catch((e) => `{"xato":"${e.message}"}`);
  const reja = jsonAjrat(rejaMatn);
  if (!reja || !Array.isArray(reja.qadamlar) || !reja.qadamlar.length) {
    await tg.sendMessage(guruh, `🤷 Buyruqni rejaga aylantira olmadim.${reja && reja.izoh ? `\n${reja.izoh}` : ''}`);
    return;
  }
  const qadamlar = reja.qadamlar.filter((q) => AGENTLAR[q.bot]).slice(0, 5);
  await tg.sendMessage(guruh, `🧭 Reja${reja.izoh ? `: ${reja.izoh}` : ''}\n${qadamlar.map((q, i) => `${i + 1}. ${AGENTLAR[q.bot].nomi} — ${q.vazifa}`).join('\n')}`);
  let kontekst = '';
  for (const q of qadamlar) {
    const a = AGENTLAR[q.bot];
    let natija;
    try {
      if (q.bot === 'claude') {
        const qosh = /holat|ishlayapti|to'xta|status/i.test(q.vazifa) ? await botlarHolati()
          : /statistik|nechta|hisob/i.test(q.vazifa) ? statistika.hisobot(7) : '';
        natija = { ok: true, matn: await claudeQadam(q.vazifa, kontekst, guruh, qosh) };
      } else if (a.url) {
        natija = await postJson(a.url, { vazifa: q.vazifa, kontekst, guruh });
      } else {
        natija = { ok: false, xato: 'hali jamoaga ulanmagan' };
      }
    } catch (e) {
      natija = { ok: false, xato: e.message };
    }
    statistika.qayd(`agent_${q.bot}`);
    if (!natija || !natija.ok) {
      await tg.sendMessage(guruh, `⚠️ ${a.nomi}: ${(natija && natija.xato) || 'bajarilmadi'}`);
      continue;
    }
    if (natija.guruhga === false) await tg.sendMessage(guruh, `${a.nomi} guruhga yoza olmadi (botni guruhga qo'shing). Natijasi:\n${String(natija.matn).slice(0, 3500)}`);
    kontekst += `\n[${a.nomi}]: ${String(natija.matn || '').slice(0, 2000)}`;
  }
}

// Guruh xabari dispetcherga tegishlimi: @mention, /v, /vazifa yoki Claude Asadbek xabariga reply
async function buyruqAjrat(message) {
  const t = String(message.text || message.caption || '').trim();
  const u = await username();
  if (/^\/(v|vazifa)(@\w+)?(\s|$)/i.test(t)) return t.replace(/^\/\w+(@\w+)?\s*/i, '');
  // "Vazifa: ..." / "Claude, ..." - oddiy matn: boshqa botlar (privacy rejimida) buni umuman ko'rmaydi,
  // "/v" esa guruhga oxirgi yozgan botga ham boradi (masalan BazisUsta javob qaytaradi)
  const m = t.match(/^(vazifa|claude)\s*[:,]\s*([\s\S]+)/i);
  if (m) return m[2].trim();
  const re = new RegExp(`@${u}\\b`, 'i');
  if (re.test(t)) return t.replace(re, '').trim();
  const r = message.reply_to_message;
  if (r && r.from && r.from.is_bot && r.from.username && r.from.username.toLowerCase() === u.toLowerCase()) return t;
  return null;
}

module.exports = { bajar, buyruqAjrat, AGENTLAR };
