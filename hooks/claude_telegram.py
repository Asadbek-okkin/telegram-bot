"""
Claude Code hooki: kompyuter oldida bo'lmaganingizda Claude'ning savollariga @claude_asadbek_bot orqali javob berish.

Bot Hetzner serverda Telegram'ni tinglaydi, shuning uchun bu skript getUpdates chaqirmaydi (409 bo'lardi) -
savolni serverga yuboradi (https://inok.uz/claude-pc/savol, kalit: C:/ProgramData/KompyuterAgent/kalit.txt)
va javobni serverdan kutadi (/javob). Serverdagi qism: claude-savol.js.

Rejimlar (birinchi argument), ~/.claude/settings.json da ulanadi:
  ruxsat - PermissionRequest: asbob ruxsati (✅ Ruxsat / ❌ Rad, matn yozsangiz - rad + izoh Claude'ga)
  savol  - PreToolUse (AskUserQuestion): variantli savollar, javob updatedInput.answers orqali
  stop   - Stop: Claude ishni tugatib to'xtaganda oxirgi xabari Telegram'ga keladi; matn yozsangiz Claude davom etadi

Qachon ishlaydi: kompyuter CLAUDE_TG_IDLE_MIN daqiqa (standart 10) harakatsiz bo'lsa, yoki
~/.claude/telegram-uzoqda fayli bo'lsa (darrov "uzoqdaman" rejimi). Aks holda hech narsa qilmaydi.
Kutish paytida kompyuterda sichqoncha/klaviatura qimirlasa - Telegram savoli yopiladi va VS Code'dagi oddiy oyna chiqadi.
XAVFSIZLIK: xato, vaqt tugashi, kalit yo'qligi - hammasida hech narsa chiqarilmaydi (oddiy so'rovga qaytadi),
hech qachon o'zi ruxsat bermaydi. O'chirish: PM_TELEGRAM_APPROVAL_ENABLED=0.
"""
import ctypes
import json
import os
import sys
import time
import urllib.request
import uuid

SERVER = os.environ.get("CLAUDE_TG_SERVER", "https://inok.uz/claude-pc").rstrip("/")
KALIT_FAYL = os.environ.get("CLAUDE_TG_KALIT_FAYL", "C:/ProgramData/KompyuterAgent/kalit.txt")
UZOQDA_FAYL = os.environ.get("CLAUDE_TG_UZOQDA_FAYL") or os.path.join(os.path.expanduser("~"), ".claude", "telegram-uzoqda")
IDLE_MIN = float(os.environ.get("CLAUDE_TG_IDLE_MIN") or os.environ.get("PM_TELEGRAM_IDLE_MIN") or 10)
KUTISH_S = int(os.environ.get("CLAUDE_TG_WAIT_S", 25 * 60))  # settings.json dagi timeout'dan kam bo'lsin
QAYTGAN_S = 20  # kompyuterda shuncha soniya ichida harakat bo'lsa - foydalanuvchi qaytgan


def idle_soniya():
    try:
        class LASTINPUTINFO(ctypes.Structure):
            _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_uint)]

        li = LASTINPUTINFO()
        li.cbSize = ctypes.sizeof(li)
        if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(li)):
            return None
        return ((ctypes.windll.kernel32.GetTickCount() - li.dwTime) & 0xFFFFFFFF) / 1000.0
    except Exception:
        return None


def uzoqdami():
    if os.path.exists(UZOQDA_FAYL):
        return True
    s = idle_soniya()
    return s is not None and s >= IDLE_MIN * 60


def qaytdimi():
    if os.path.exists(UZOQDA_FAYL):
        return False
    s = idle_soniya()
    return s is not None and s < QAYTGAN_S


def kalit():
    try:
        with open(KALIT_FAYL, encoding="utf-8") as f:
            return f.read().strip()
    except Exception:
        return ""


def post(yol, data, timeout=15):
    req = urllib.request.Request(
        SERVER + yol,
        data=json.dumps(data).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-Kalit": kalit()},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8") or "{}")


def sora(matn, tugmalar, kop=False, erkin=True):
    """Telegram'ga savol yuboradi va javobni kutadi. Javob: {"qiymat": ...} yoki {"matn": ...}; bo'lmasa None."""
    sid = uuid.uuid4().hex[:12]
    try:
        if not post("/savol", {"id": sid, "matn": matn, "tugmalar": tugmalar, "kop": kop, "erkin": erkin}).get("ok"):
            return None
    except Exception:
        return None
    oxir = time.time() + KUTISH_S
    izoh = "vaqt tugadi — kompyuterda javob beriladi"
    while time.time() < oxir:
        if qaytdimi():
            izoh = "kompyuterga qaytdingiz — u yerda javob beriladi"
            break
        try:
            r = post("/javob", {"id": sid}, timeout=40)
        except Exception:
            time.sleep(5)
            continue
        if r.get("javob"):
            return r["javob"]
        if r.get("yoq"):
            return None
    try:
        post("/yopildi", {"id": sid, "izoh": izoh})
    except Exception:
        pass
    return None


def loyiha(inp):
    d = os.environ.get("CLAUDE_PROJECT_DIR") or inp.get("cwd") or ""
    return os.path.basename(d.rstrip("/\\")) or "loyiha"


def qisqa(s, n):
    s = str(s)
    return s if len(s) <= n else s[:n] + "…"


def asbob_tafsiloti(nom, ti):
    if not isinstance(ti, dict):
        return qisqa(ti, 1500)
    if nom in ("Bash", "PowerShell"):
        t = ti.get("command", "")
        if ti.get("description"):
            t = ti["description"] + "\n\n" + t
        return qisqa(t, 2000)
    if nom in ("Edit", "Write", "NotebookEdit", "Read"):
        t = ti.get("file_path") or ti.get("notebook_path") or ""
        yangi = ti.get("new_string") or ti.get("content") or ""
        if yangi:
            t += "\n---\n" + qisqa(yangi, 1200)
        return t
    if nom == "WebFetch":
        return ti.get("url", "")
    return qisqa(json.dumps(ti, ensure_ascii=False, indent=1), 1500)


def chiqar(obj):
    sys.stdout.write(json.dumps(obj))
    sys.exit(0)


def rejim_ruxsat(inp):
    nom = inp.get("tool_name", "?")
    if nom == "AskUserQuestion":
        return  # bu "savol" rejimida (PreToolUse) hal qilinadi
    matn = f"🔐 Ruxsat so'ralmoqda ({loyiha(inp)})\nAsbob: {nom}\n\n{asbob_tafsiloti(nom, inp.get('tool_input'))}\n\nMatn yozsangiz - rad etiladi va matningiz Claude'ga yetkaziladi."
    j = sora(matn, [{"t": "✅ Ruxsat", "v": "allow"}, {"t": "❌ Rad", "v": "deny"}])
    if not j:
        return
    if j.get("qiymat") == "allow":
        chiqar({"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": {"behavior": "allow"}}})
    msg = "Foydalanuvchi Telegram orqali rad etdi."
    if j.get("matn"):
        msg = f"Foydalanuvchi Telegram orqali rad etdi va yozdi: {j['matn']}"
    chiqar({"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": {"behavior": "deny", "message": msg}}})


def rejim_savol(inp):
    if inp.get("tool_name") != "AskUserQuestion":
        return
    ti = inp.get("tool_input") or {}
    savollar = ti.get("questions") or []
    if not savollar:
        return
    javoblar = {}
    jami = len(savollar)
    for n, q in enumerate(savollar, 1):
        opts = q.get("options") or []
        kop = bool(q.get("multiSelect"))
        sarlavha = q.get("header") or "Savol"
        tartib = f" {n}/{jami}" if jami > 1 else ""
        qatorlar = [f"❓ Claude so'rayapti{tartib} ({loyiha(inp)}) — {sarlavha}", "", q.get("question", "")]
        for o in opts:
            if o.get("description"):
                qatorlar.append(f"• {o.get('label')} — {o['description']}")
        qatorlar.append("")
        qatorlar.append("Tugmani bosing yoki o'z javobingizni yozing." + (" (Bir nechtasini belgilab ✔ Tayyor)" if kop else ""))
        tugmalar = [{"t": o.get("label", ""), "v": o.get("label", "")} for o in opts]
        j = sora("\n".join(qatorlar), tugmalar, kop=kop)
        if not j:
            return  # biror savolga javob bo'lmasa - hammasi kompyuterdagi oddiy oynaga qoladi
        if "matn" in j:
            javoblar[q.get("question", "")] = j["matn"]
        else:
            v = j.get("qiymat")
            javoblar[q.get("question", "")] = ", ".join(v) if isinstance(v, list) else str(v)
    yangi = dict(ti)
    yangi["answers"] = javoblar
    chiqar({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "allow",
        "permissionDecisionReason": "Telegram orqali javob berildi",
        "updatedInput": yangi,
    }})


def oxirgi_xabar(inp):
    m = inp.get("last_assistant_message")
    if isinstance(m, str) and m.strip():
        return m
    yol = inp.get("transcript_path")
    if not yol or not os.path.exists(yol):
        return ""
    try:
        with open(yol, encoding="utf-8") as f:
            qatorlar = f.readlines()[-200:]
    except Exception:
        return ""
    for q in reversed(qatorlar):
        try:
            e = json.loads(q)
        except Exception:
            continue
        if e.get("type") != "assistant":
            continue
        kontent = (e.get("message") or {}).get("content")
        if isinstance(kontent, str) and kontent.strip():
            return kontent
        if isinstance(kontent, list):
            t = "\n".join(c.get("text", "") for c in kontent if isinstance(c, dict) and c.get("type") == "text").strip()
            if t:
                return t
    return ""


def rejim_stop(inp):
    xabar = oxirgi_xabar(inp)
    if len(xabar) > 3000:
        xabar = "…" + xabar[-3000:]
    matn = f"🤖 Claude to'xtadi ({loyiha(inp)}):\n\n{xabar or '(matn yo‘q)'}\n\nDavom ettirish uchun javob yozing."
    j = sora(matn, [{"t": "⏹ Hozircha shu yetarli", "v": "stop"}])
    if not j or not j.get("matn"):
        return
    chiqar({"decision": "block", "reason": f"Foydalanuvchi kompyuter oldida emas, Telegram orqali javob yozdi: {j['matn']}"})


def main():
    if os.environ.get("PM_TELEGRAM_APPROVAL_ENABLED") == "0":
        return
    rejim = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        inp = json.loads(sys.stdin.buffer.read().decode("utf-8") or "{}")
    except Exception:
        return
    if not uzoqdami() or not kalit():
        return
    {"ruxsat": rejim_ruxsat, "savol": rejim_savol, "stop": rejim_stop}.get(rejim, lambda _i: None)(inp)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        pass
    sys.exit(0)
