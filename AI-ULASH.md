# 🧠 Yangi sun'iy intellektni ulash (Claude Code o'rniga)

Claude Asadbek boti hech bir AI'ga qattiq bog'lanmagan. Yangi AI uch xil rolda ulanadi —
hammasi bot kodini o'zgartirmasdan.

## 1. Miya — Claude Asadbek u bilan o'ylaydi

Reja tuzish, majlis, natijalarni tekshirish, oddiy suhbat — shu AI bilan bo'ladi.
Talab: **OpenAI'ga mos API** (`POST <manzil>/chat/completions`, `{model, messages}` →
`choices[0].message.content`). Ko'p AI serverlari (vLLM, Ollama, LM Studio, OpenRouter …) shunday ishlaydi.

Telegram'da, shaxsiy chatda:

```
/miya_ulash Bizning AI | https://ai.misol.uz/v1 | model-nomi | kalit
/miya            — hozirgi miya va oxirgi xato
/miya_gemini     — Gemini'ga qaytish
```

Ulashda bot bitta sinov savol beradi; ishlasa — saqlaydi. Yangi AI keyinchalik javob bermasa,
bot o'zi Gemini'ga o'tadi (ish to'xtamaydi) va `/miya` da xatoni ko'rsatadi. Kalit faqat serverdagi
`data/miya.json` da (git'da emas).

## 2. Boshqaruvchi — Claude Code o'rnida kompyuterda ishlaydi

Hozir Claude Code kompyuterda kod yozadi, bot esa uning sessiyalarini ko'rsatadi, savollarini
Telegram'ga olib keladi va javoblaringizni unga yetkazadi. Yangi AI shu ishni qilishi uchun
**xuddi shu HTTP protokolni** ishlatadi (`https://inok.uz/claude-pc/...`, sarlavha `X-Kalit:
C:\ProgramData\KompyuterAgent\kalit.txt`):

| So'rov | Nima uchun |
|---|---|
| `POST /holat {sid, loyiha, mavzu, holat, xabar?, bildir?, ol?}` | sessiya holati (`ishlayapti`/`kutyapti`/`tayyor`/`tugadi`); `bildir:true` — javobni Telegram'ga yuborish; `ol:true` — Telegram'dan kelgan xabarlarni olish |
| `POST /kut {sid}` | bo'sh turganda Telegram'dan xabar kutish (25 s long-poll) → `{xabarlar:[...]}` |
| `POST /savol {id, matn, tugmalar:[{t,v}], kop?, erkin?}` | ruxsat/savol tugmalar bilan Telegram'ga |
| `POST /javob {id}` | foydalanuvchi javobini kutish → `{javob:{qiymat|matn}}` |
| `POST /yopildi {id, izoh}` | savol kompyuterda hal bo'ldi — tugmalarni olib tashlash |

Tayyor namuna — `hooks/claude_telegram.py` (Claude Code hooklari shu so'rovlarni yuboradi).
Yangi AI o'z dasturida shu 5 ta so'rovni yuborsa — «🤖 Claude Code» bo'limi, ovozli/skrinshot
buyruqlar, javoblarni Telegram'ga yuborish, sessiyani yopish — hammasi u bilan ishlaydi.
Telegram'dagi rasm `[[rasm:<id>]]` belgisi bilan keladi — `POST /rasm {id}` faylni beradi.

## 3. Jamoa a'zosi — guruhda vazifa bajaradi

Boshqa botlar kabi: `/bot_qosh Nomi | nima qiladi | agent-eshigi-url` (qarang: `BOT-ULASH.md`).

## Qoidalar (har bir yangi AI/bot uchun)
- Yangi versiya chiqsa adminga «🆕 Yangi versiya chiqdi — yangilang» + 🔄 tugma.
- Yaratilgan rasmlarda suv belgisi bo'lmasin.
- Guruhda faqat chaqirilganda (`@nomi` yoki reply) javob bersin.
