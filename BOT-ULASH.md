# 🤝 Yangi botni Claude Asadbek jamoasiga ulash

Claude Asadbek — botlar jamoasining boshlig'i. U guruhda buyruqni qabul qiladi, vazifani botlarga bo'lib
beradi, natijalarni yig'adi va tekshiradi. Yangi botni ulash uchun Claude Code shart emas.

## 1. Botga "agent eshigi" qo'shing

Bot bitta narsani bilishi kerak: vazifa kelsa bajarib, natijani qaytarish.

```
POST <url>      sarlavha: X-Agent-Kalit: <kalit>
so'rov:  {"vazifa": "...", "kontekst": "oldingi botlar natijasi", "guruh": -100...}
javob:   {"ok": true, "matn": "natija"}
GET <url>  ->  {"ok": true}        (majlis davomati uchun)
```

Natijani bot guruhga **o'z nomidan** yozadi (`guruh` ga sendMessage) va `matn` ni qaytaradi.

- **Python bot:** tayyor shablon `deploy/agent_shablon.py` — 3 qator bilan ulanadi (ichida yozilgan).
- **Boshqa tilda:** yuqoridagi ikki so'rovni qabul qiladigan kichik HTTP manzil yetarli.

## 2. Claude Asadbek'ga ro'yxatdan o'tkazing (Telegram'da, shaxsiy chatda)

```
/bot_qosh Bot nomi | nima ish qiladi | http://manzil:port/agent
```

Claude Asadbek **agent kaliti** beradi — uni botingizga yozing (`X-Agent-Kalit` tekshiruvi).
"Nima ish qiladi" qismini aniq yozing: Claude vazifani shunga qarab beradi.

## 3. Botni "Avtobotlar" guruhiga qo'shing

Tayyor. Tekshirish: shaxsiy chatda `/jamoa` — bot 🟢 ulangan bo'lishi kerak.

## Foydali buyruqlar

| Qayerda | Buyruq | Nima qiladi |
|---|---|---|
| Guruh | `Vazifa: ...` yoki `Claude, ...` | Claude rejalaydi, botlarga bo'lib beradi, natijani tekshiradi |
| Guruh | `Claude, majlis` | 🏛 Majlis: davomat → kun tartibi → vazifalar → tekshiruv |
| Guruh | `Majlis: ...` | Vazifani majlis kun tartibiga qo'shadi |
| Guruh | `/botlar`, `/statistika` | Holat va botlar reytingi |
| Shaxsiy | `🏛 Majlis` tugmasi | Kun tartibi, majlisni hozir boshlash |
| Shaxsiy | `/majlis_vazifa ...`, `/majlis_soat 09:30` | Vazifa qo'shish, kunlik majlis vaqti |
| Shaxsiy | `/bot_qosh`, `/bot_ochir id`, `/jamoa` | Botlarni ulash/chiqarish/ko'rish |
