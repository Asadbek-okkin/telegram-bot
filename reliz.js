/* GitHub Releases oynasi: GET https://inok.uz/claude-pc/reliz/<repo>
Ofis kompyuterlari bitta tashqi IP dan chiqadi va GitHub API'ning kalitsiz limiti (soatiga 60 so'rov) tez tugaydi
-> Kamera AI "403 rate limit exceeded" bilan yangilanishni tekshira olmasdi. Server relizni o'zi oladi
(soatiga 1 marta, keshda), asset "url"larini API emas, oddiy yuklab olish havolasiga (browser_download_url,
limitsiz) almashtiradi. Format GitHub API'niki bilan bir xil. Butunlik dasturdagi imzo tekshiruvida (versiya.json). */
const https = require('https');

const REPOLAR = {
  'kamera-ai': 'Asadbek-okkin/kamera-ai',
  'sof-ozbek-klaviatura': 'Asadbek-okkin/sof-ozbek-klaviatura', // ⌨️ telefon klaviaturasi (klaviatura.js)
};
const KESH_MS = 60 * 60 * 1000;
const kesh = {}; // repo -> {vaqt, matn}

function ol(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'claude-asadbek-bot', Accept: 'application/vnd.github+json' } }, (res) => {
      let s = '';
      res.on('data', (c) => { s += c; });
      res.on('end', () => (res.statusCode === 200 ? resolve(s) : reject(new Error(`GitHub ${res.statusCode}`))));
    }).on('error', reject);
  });
}

async function reliz(repo) {
  const k = kesh[repo];
  if (k && Date.now() - k.vaqt < KESH_MS) return k.matn;
  try {
    const r = JSON.parse(await ol(`https://api.github.com/repos/${REPOLAR[repo]}/releases/latest`));
    for (const a of r.assets || []) if (a.browser_download_url) a.url = a.browser_download_url;
    const matn = JSON.stringify(r);
    kesh[repo] = { vaqt: Date.now(), matn };
    return matn;
  } catch (e) {
    if (k) return k.matn; // GitHub javob bermasa - eski kesh
    throw e;
  }
}

function handleHttp(req, res) {
  if (req.method !== 'GET') return false;
  const m = req.url.split('?')[0].match(/\/reliz\/([\w-]+)\/?$/);
  if (!m) return false;
  if (!REPOLAR[m[1]]) { res.writeHead(404); res.end(); return true; }
  reliz(m[1])
    .then((matn) => { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(matn); })
    .catch((e) => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ xato: e.message })); });
  return true;
}

module.exports = { handleHttp, reliz };
