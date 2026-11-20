"""
Claude Code hooki: kompyuter oldida bo'lmaganingizda Claude'ning savollariga @claude_asadbek_bot orqali javob berish.

Bot Hetzner serverda Telegram'ni tinglaydi, shuning uchun bu skript getUpdates chaqirmaydi (409 bo'lardi) -
savolni serverga yuboradi (https://inok.uz/claude-pc/savol, kalit: C:/ProgramData/KompyuterAgent/kalit.txt)
va javobni serverdan kutadi (/javob). Serverdagi qism: claude-savol.js.

Rejimlar (birinchi argument), ~/.claude/settings.json da ulanadi:
  ruxsat - PermissionRequest: asbob ruxsati (✅ Ruxsat / ❌ Rad, matn yozsangiz - rad + izoh Claude'ga)
  savol  - PreToolUse (AskUserQuestion): variantli savollar, javob updatedInput.answers orqali
  holat  - SessionStart/UserPromptSubmit/PostToolUse/Notification/SessionEnd: sessiya holati serverga
           ("🤖 Claude Code" tugmasi uchun). PostToolUse da Telegram'dan yozilgan xabar bo'lsa - Claude'ga beriladi.
  kutish - Stop (async + asyncRewake): sessiya bo'sh turganda Telegram'dan xabar kutadi; kelsa exit 2 bilan
           Claude'ni uyg'otadi. Uzoqda bo'lsangiz Claude'ning oxirgi xabarini Telegram'ga yuboradi.
  stop   - (eski, ishlatilmaydi) Stop hookida sinxron kutish.

ruxsat/savol/stop qachon ishlaydi: kompyuter CLAUDE_TG_IDLE_MIN daqiqa (standart 10) harakatsiz bo'lsa, yoki
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
HOLAT_PAPKA = os.environ.get("CLAUDE_TG_HOLAT_PAPKA") or os.path.join(os.path.expanduser("~"), ".claude", "tg-sessiya")
YURAK_S = 10  # PostToolUse: bir xil holatni serverga shundan tez-tez yubormaymiz
KUTISH_MAX_S = int(os.environ.get("CLAUDE_TG_KUTISH_MAX_S", 23 * 3600))  # settings.json timeout'dan kam


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


# ------------------------------------------------------------------ sessiya holati

def mavzu(inp):
    t = inp.get("session_title")
    if t:
        return t
    return transkript_mavzusi(inp.get("transcript_path"))


CLAUDE_PAPKA = os.path.join(os.path.expanduser("~"), ".claude")


def jarayon_tirikmi(pid):
    try:
        k32 = ctypes.windll.kernel32
        h = k32.OpenProcess(0x1000, False, int(pid))  # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return False
        kod = ctypes.c_ulong()
        ok = k32.GetExitCodeProcess(h, ctypes.byref(kod))
        k32.CloseHandle(h)
        return bool(ok) and kod.value == 259  # STILL_ACTIVE
    except Exception:
        return True


def jonli_sessiyalar():
    """~/.claude/sessions/<pid>.json - Claude Code'ning o'zi yuritadigan ochiq sessiyalar ro'yxati
    (status: busy/idle). Jarayoni tirik bo'lganlarini qaytaradi; None = ro'yxatni o'qib bo'lmadi."""
    papka = os.path.join(CLAUDE_PAPKA, "sessions")
    try:
        fayllar = [x for x in os.listdir(papka) if x.endswith(".json")]
    except Exception:
        return None
    natija = []
    for x in fayllar:
        try:
            with open(os.path.join(papka, x), encoding="utf-8") as f:
                d = json.load(f)
        except Exception:
            continue
        if d.get("kind") not in (None, "interactive") or not d.get("sessionId"):
            continue
        if not jarayon_tirikmi(d.get("pid", 0)):
            continue
        sid = d["sessionId"]
        tr = ""
        try:
            import glob
            g = glob.glob(os.path.join(CLAUDE_PAPKA, "projects", "*", sid + ".jsonl"))
            tr = g[0] if g else ""
        except Exception:
            pass
        st = d.get("status", "")
        natija.append({
            "sid": sid,
            "loyiha": os.path.basename(str(d.get("cwd", "")).rstrip("/\\")) or "loyiha",
            "mavzu": transkript_mavzusi(tr) or d.get("name", ""),
            "holat": "ishlayapti" if st == "busy" else "tayyor" if st == "idle" else "kutyapti",
        })
    return natija


def transkript_mavzusi(yol):
    if not yol or not os.path.exists(yol):
        return ""
    try:
        with open(yol, "rb") as f:
            f.seek(0, 2)
            n = f.tell()
            f.seek(max(0, n - 400000))
            dum = f.read().decode("utf-8", "ignore").splitlines()
    except Exception:
        return ""
    oxirgi_prompt = ""
    for q in reversed(dum):
        if '"ai-title"' in q or '"custom-title"' in q:
            try:
                e = json.loads(q)
                t = e.get("customTitle") or e.get("aiTitle")
                if t:
                    return t
            except Exception:
                pass
        if not oxirgi_prompt and '"last-prompt"' in q:
            try:
                oxirgi_prompt = json.loads(q).get("lastPrompt", "")
            except Exception:
                pass
    return qisqa(oxirgi_prompt, 80) if oxirgi_prompt else ""


def sid_of(inp):
    return "".join(ch for ch in str(inp.get("session_id", "")) if ch.isalnum() or ch == "-")[:64]


def holat_yubor(inp, holat, izoh="", ol=False, timeout=4, **qo):
    sid = sid_of(inp)
    if not sid:
        return []
    data = {"sid": sid, "loyiha": loyiha(inp), "mavzu": mavzu(inp), "holat": holat, "izoh": izoh, "ol": ol}
    royxat = jonli_sessiyalar()
    if royxat is not None:
        data["royxat"] = royxat  # server ro'yxatdagi boshqa (hook hali ishlamagan/yopilgan) sessiyalarni ham tuzatadi
    data.update(qo)
    if holat != "ishlayapti":  # keyingi PostToolUse "ishlayapti" ni darrov yuborsin
        try:
            os.remove(holat_fayl(sid, "yurak"))
        except Exception:
            pass
    try:
        return post("/holat", data, timeout=timeout).get("xabarlar") or []
    except Exception:
        return []


def holat_fayl(sid, tur):
    os.makedirs(HOLAT_PAPKA, exist_ok=True)
    return os.path.join(HOLAT_PAPKA, f"{sid}.{tur}")


def telegram_matni(xabarlar):
    return "Foydalanuvchi Telegram (@claude_asadbek_bot) orqali shu sessiyaga yozdi - buni yangi topshiriq/javob deb bajaring:\n" + "\n---\n".join(xabarlar)


def kutishni_toxtat(sid):
    try:
        os.remove(holat_fayl(sid, "kut"))
    except Exception:
        pass


def rejim_holat(inp):
    hodisa = inp.get("hook_event_name", "")
    sid = sid_of(inp)
    if not sid:
        return
    if hodisa == "SessionStart":
        holat_yubor(inp, "tayyor")
    elif hodisa == "UserPromptSubmit":
        kutishni_toxtat(sid)
        holat_yubor(inp, "ishlayapti")
    elif hodisa == "SessionEnd":
        kutishni_toxtat(sid)
        holat_yubor(inp, "tugadi", timeout=3)
    elif hodisa == "Notification":
        tur = inp.get("notification_type", "")
        if tur in ("permission_prompt", "elicitation_dialog", "agent_needs_input"):
            holat_yubor(inp, "kutyapti", qisqa(inp.get("message", "ruxsat so'rayapti"), 70))
        elif tur == "idle_prompt":
            holat_yubor(inp, "tayyor")
    elif hodisa == "PostToolUse":
        f = holat_fayl(sid, "yurak")
        try:
            if time.time() - os.path.getmtime(f) < YURAK_S:
                return
        except OSError:
            pass
        open(f, "w").close()
        xabarlar = holat_yubor(inp, "ishlayapti", inp.get("tool_name", ""), ol=True, timeout=4)
        if xabarlar:
            chiqar({"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": telegram_matni(xabarlar)}})


def rejim_kutish(inp):
    """Stop hodisasi, fonda (async + asyncRewake). Telegram'dan xabar kelsa - exit 2 bilan Claude'ni uyg'otadi."""
    sid = sid_of(inp)
    if not sid:
        return
    uzoq = uzoqdami()
    xabarlar = holat_yubor(inp, "tayyor", ol=True, bildir=uzoq, xabar=oxirgi_xabar(inp), timeout=10)
    belgi = uuid.uuid4().hex
    f = holat_fayl(sid, "kut")
    with open(f, "w") as h:
        h.write(belgi)

    def menikimi():
        try:
            with open(f) as h:
                return h.read().strip() == belgi
        except Exception:
            return False

    oxir = time.time() + KUTISH_MAX_S
    oxirgi_royxat = time.time()
    while not xabarlar and time.time() < oxir and menikimi():
        if time.time() - oxirgi_royxat > 60:  # bo'sh turgan paytda ham ro'yxat (boshqa sessiyalar holati) yangilanib tursin
            oxirgi_royxat = time.time()
            r = jonli_sessiyalar()
            if r is not None:
                try:
                    post("/holat", {"royxat": r}, timeout=10)
                except Exception:
                    pass
        try:
            xabarlar = post("/kut", {"sid": sid}, timeout=40).get("xabarlar") or []
        except Exception:
            time.sleep(15)
    if menikimi():
        kutishni_toxtat(sid)
    if xabarlar:
        sys.stderr.write(telegram_matni(xabarlar))
        sys.stderr.flush()
        sys.exit(2)


def main():
    if os.environ.get("PM_TELEGRAM_APPROVAL_ENABLED") == "0":
        return
    rejim = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        inp = json.loads(sys.stdin.buffer.read().decode("utf-8") or "{}")
    except Exception:
        return
    if not kalit():
        return
    if rejim == "holat":
        return rejim_holat(inp)
    if rejim == "kutish":
        return rejim_kutish(inp)
    if rejim in ("ruxsat", "savol"):
        nom = inp.get("tool_name", "")
        if rejim == "ruxsat" and nom != "AskUserQuestion":
            holat_yubor(inp, "kutyapti", f"ruxsat: {nom}")
        elif rejim == "savol" and nom == "AskUserQuestion":
            holat_yubor(inp, "kutyapti", "savol berdi")
    if not uzoqdami():
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
