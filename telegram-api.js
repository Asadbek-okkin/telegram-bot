/* Telegram Bot API ustidan yupqa qatlam - faqat HTTP chaqiruvlar, biznes-mantiq yo'q.
bot.js (holat/g'oyalar) va moderator.js (mebel kanal boshqaruvi) shu modulni baham ko'radi. */
const https = require('https');

const TOKEN = process.env.PM_TELEGRAM_BOT_TOKEN;

function apiCall(method, params) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(params);
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${TOKEN}/${method}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function sendMessage(chatId, text, extra) {
  return apiCall('sendMessage', { chat_id: chatId, text, ...extra }).catch((e) => console.error('Telegram sendMessage error:', e.message));
}

function sendPhoto(chatId, photo, extra) {
  return apiCall('sendPhoto', { chat_id: chatId, photo, ...extra }).catch((e) => console.error('Telegram sendPhoto error:', e.message));
}

function editMessageText(chatId, messageId, text, extra) {
  return apiCall('editMessageText', { chat_id: chatId, message_id: messageId, text, ...extra }).catch((e) => console.error('Telegram editMessageText error:', e.message));
}

function answerCallbackQuery(callbackQueryId, extra) {
  return apiCall('answerCallbackQuery', { callback_query_id: callbackQueryId, ...extra }).catch(() => {});
}

function getUpdates(offset) {
  return new Promise((resolve, reject) => {
    https
      .get(`https://api.telegram.org/bot${TOKEN}/getUpdates?offset=${offset}&timeout=25`, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      })
      .on('error', reject);
  });
}

// Telegram'dagi faylni (masalan ovozli xabarni) yuklab olish -> Buffer
async function faylYukla(fileId) {
  const r = await apiCall('getFile', { file_id: fileId });
  if (!r || !r.ok) throw new Error('getFile xato');
  return new Promise((resolve, reject) => {
    https.get(`https://api.telegram.org/file/bot${TOKEN}/${r.result.file_path}`, (res) => {
      const ch = [];
      res.on('data', (c) => ch.push(c));
      res.on('end', () => resolve(Buffer.concat(ch)));
    }).on('error', reject);
  });
}

module.exports = { TOKEN, apiCall, faylYukla, sendMessage, sendPhoto, editMessageText, answerCallbackQuery, getUpdates };
