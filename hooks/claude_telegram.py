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
import urllib.error
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


def uzoqdami(daqiqa=None):
    if os.path.exists(UZOQDA_FAYL):
        return True
    s = idle_soniya()
    return s is not None and s >= (IDLE_MIN if daqiqa is None else daqiqa) * 60


# Claude javobini Telegram'ga yuborish chegarasi: kompyuter shuncha daqiqa harakatsiz bo'lsa
BILDIR_MIN = float(os.environ.get("CLAUDE_TG_BILDIR_MIN") or 2)
# Javob kelgach shuncha soniya kompyuterga tegilmasa - javob Telegram'ga yuboriladi
JAVOB_KUT_S = int(os.environ.get("CLAUDE_TG_JAVOB_KUT_S") or 60)


def telegramdan_belgila(sid):
    """Sessiyaga oxirgi topshiriq Telegram'dan keldi - Claude'ning javobi ham Telegram'ga qaytsin."""
    try:
        open(holat_fayl(sid, "tg"), "w").close()
    except Exception:
        pass


def telegramdanmi(sid):
    try:
        return os.path.exists(holat_fayl(sid, "tg"))
    except Exception:
        return False


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
            "mavzu": transkript_mavzusi(tr) or (d.get("name", "") if d.get("nameSource") != "derived" else ""),
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
    ai_nom = ""
    for q in reversed(dum):
        # Qo'lda qo'yilgan nom (/rename, custom-title) har doim AI nomidan ustun:
        # Claude Code ai-title'ni vaqti-vaqti bilan qayta yozadi, u custom nomni bosib ketmasin.
        if '"custom-title"' in q:
            try:
                t = json.loads(q).get("customTitle")
                if t:
                    return t
            except Exception:
                pass
        elif not ai_nom and '"ai-title"' in q:
            try:
                ai_nom = json.loads(q).get("aiTitle") or ""
            except Exception:
                pass
        if not oxirgi_prompt and '"last-prompt"' in q:
            try:
                oxirgi_prompt = json.loads(q).get("lastPrompt", "")
            except Exception:
                pass
    if ai_nom:
        return ai_nom
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


def rasm_yukla(rid):
    """Telegram'dan yuborilgan skrinshotni serverdan olib, ~/.claude/tg-sessiya/rasmlar/<id>.jpg ga saqlaydi."""
    papka = os.path.join(HOLAT_PAPKA, "rasmlar")
    os.makedirs(papka, exist_ok=True)
    yol = os.path.join(papka, rid + ".jpg")
    if not os.path.exists(yol):
        req = urllib.request.Request(SERVER + "/rasm", data=json.dumps({"id": rid}).encode("utf-8"),
                                     headers={"Content-Type": "application/json", "X-Kalit": kalit()}, method="POST")
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
        with open(yol, "wb") as f:
            f.write(data)
    return yol


def rasmlarni_almashtir(matn):
    import re

    def ozgar(m):
        try:
            return f"[Telegram'dan yuborilgan rasm (skrinshot) - Read asbobi bilan ochib ko'ring: {rasm_yukla(m.group(1))}]"
        except Exception as e:
            return f"[rasm yuklab olinmadi: {e}]"

    return re.sub(r"\[\[rasm:([0-9a-f]{16})\]\]", ozgar, matn)


def telegram_matni(xabarlar):
    return ("Foydalanuvchi Telegram (@claude_asadbek_bot) orqali shu sessiyaga yozdi - buni yangi topshiriq/javob deb bajaring:\n"
            + "\n---\n".join(rasmlarni_almashtir(x) for x in xabarlar))


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
        idle = idle_soniya()
        if idle is not None and idle < 60 and not os.path.exists(UZOQDA_FAYL):
            try:  # kompyuterda o'zingiz yozdingiz - javob Telegram'ga shart emas
                os.remove(holat_fayl(sid, "tg"))
            except Exception:
                pass
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
            telegramdan_belgila(sid)
            chiqar({"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": telegram_matni(xabarlar)}})


def rejim_kutish(inp):
    """Stop hodisasi, fonda (async + asyncRewake). Telegram'dan xabar kelsa - exit 2 bilan Claude'ni uyg'otadi."""
    sid = sid_of(inp)
    if not sid:
        return
    uzoq = uzoqdami(BILDIR_MIN) or telegramdanmi(sid)
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

    # Kompyuter yonida bo'lsangiz ham: javobdan keyin JAVOB_KUT_S soniya sichqoncha/klaviaturaga tegilmasa -
    # demak kompyuter yonida emassiz, javob Telegram'ga yuboriladi. Tegilsa - yuborilmaydi.
    if not uzoq and not xabarlar:
        boshi = time.time()
        while menikimi() and time.time() - boshi < JAVOB_KUT_S:
            time.sleep(2)
            idle = idle_soniya()
            if idle is not None and idle < time.time() - boshi - 1:
                break  # javobdan keyin kompyuterga tegildi - siz shu yerdasiz
        else:
            if menikimi():
                xabarlar = holat_yubor(inp, "tayyor", ol=True, bildir=True, xabar=oxirgi_xabar(inp), timeout=10)

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
        telegramdan_belgila(sid)
        # UTF-8 baytlar: Windows konsol kodlashi o'zbek/rus harflarini ō yoki � ga buzardi
        sys.stderr.buffer.write(telegram_matni(xabarlar).encode("utf-8"))
        sys.stderr.flush()
        sys.exit(2)


# ------------------------------------------------------------------ 🧩 VS Code: sessiyani Telegram'dan ochish

NO_WINDOW = 0x08000000
_songgi_kesh = {}  # yo'l -> (mtime, {sid, cwd, loyiha, mavzu, vaqt})


def transkript_cwd(yol):
    """Transkriptdagi birinchi "cwd" va entrypoint (VS Code/CLI sessiyasimi)."""
    try:
        with open(yol, encoding="utf-8", errors="ignore") as f:
            for i, q in enumerate(f):
                if i > 200:
                    break
                if '"cwd"' not in q:
                    continue
                try:
                    e = json.loads(q)
                except Exception:
                    continue
                if e.get("cwd"):
                    return e["cwd"], str(e.get("entrypoint") or "")
    except Exception:
        pass
    return "", ""


def songgi_sessiyalar(n=12):
    """~/.claude/projects/*/<sid>.jsonl - eng so'nggi interaktiv sessiyalar (yopilganlari ham), yangisi birinchi."""
    import glob
    fayllar = []
    for yol in glob.glob(os.path.join(CLAUDE_PAPKA, "projects", "*", "*.jsonl")):
        try:
            fayllar.append((os.path.getmtime(yol), yol))
        except OSError:
            pass
    fayllar.sort(reverse=True)
    natija = []
    for mt, yol in fayllar:
        if len(natija) >= n:
            break
        k = _songgi_kesh.get(yol)
        if not k or k[0] != mt:
            sid = os.path.basename(yol)[:-6]
            cwd, kirish = transkript_cwd(yol)
            ok = bool(cwd) and os.path.isdir(cwd) and (not kirish or "vscode" in kirish or kirish == "cli")
            k = (mt, {"sid": sid, "cwd": cwd, "loyiha": os.path.basename(cwd.rstrip("/\\")) or cwd,
                      "mavzu": transkript_mavzusi(yol), "vaqt": int(mt * 1000)} if ok else None)
            _songgi_kesh[yol] = k
        if k[1]:
            natija.append(k[1])
    return natija


def code_cmd():
    for y in (os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Microsoft VS Code", "bin", "code.cmd"),
              r"C:\Program Files\Microsoft VS Code\bin\code.cmd"):
        if os.path.exists(y):
            return y
    return "code"


def vscode_ishlayaptimi():
    import subprocess
    out = subprocess.run(["tasklist", "/fi", "imagename eq Code.exe", "/nh"], capture_output=True,
                         creationflags=NO_WINDOW).stdout.decode("oem", errors="replace")
    return "code.exe" in out.lower()


def vscode_och(sid):
    """Sessiya papkasini VS Code'da ochadi (oyna oldinga chiqadi), keyin Claude Code'da shu sessiyani davom ettiradi.
    Papka serverdan olinmaydi - faqat shu kompyuterdagi o'z ro'yxatimizdan (sid bo'yicha)."""
    import subprocess
    s = next((x for x in songgi_sessiyalar(30) if x["sid"] == sid), None)
    if not s:
        return {"ok": False, "xato": "sessiya kompyuterda topilmadi"}
    edi = vscode_ishlayaptimi()
    subprocess.Popen(["cmd", "/c", code_cmd(), s["cwd"]], creationflags=NO_WINDOW)
    time.sleep(4 if edi else 12)  # yangi oyna/kengaytma yuklanguncha
    os.startfile("vscode://anthropic.claude-code/open?session=" + sid)
    return {"ok": True}


def sessiyani_yop(sid):
    """⏹ Sessiyani yopish: ~/.claude/sessions/<pid>.json dan shu sessiya jarayonini topib to'xtatadi.
    Suhbat (transkript) saqlanib qoladi - keyin "🧩 VS Code" orqali qayta ochish mumkin."""
    import subprocess
    papka = os.path.join(CLAUDE_PAPKA, "sessions")
    try:
        fayllar = [x for x in os.listdir(papka) if x.endswith(".json")]
    except Exception:
        fayllar = []
    for x in fayllar:
        try:
            with open(os.path.join(papka, x), encoding="utf-8") as f:
                d = json.load(f)
        except Exception:
            continue
        if d.get("sessionId") != sid:
            continue
        pid = int(d.get("pid") or 0)
        if not pid or not jarayon_tirikmi(pid):
            return {"ok": True}  # allaqachon yopilgan
        r = subprocess.run(["taskkill", "/pid", str(pid), "/t", "/f"], capture_output=True, creationflags=NO_WINDOW)
        time.sleep(1)
        if jarayon_tirikmi(pid):
            return {"ok": False, "xato": f"jarayon to'xtamadi (kod {r.returncode})"}
        kutishni_toxtat(sid)
        return {"ok": True}
    return {"ok": True}  # ochiq sessiyalar ro'yxatida yo'q - yopilgan


# ------------------------------------------------------------------ 🎨 AI Studio: yoqish / o'chirish

AI_PAPKA = os.environ.get("AI_STUDIO_PAPKA") or r"D:\ai-studio"


def ai_holat():
    """AI Studio ishlayaptimi; ishlasa - telefon manzillari va PIN (/api/telefon faqat kompyuterning o'zidan ochiladi)."""
    try:
        with urllib.request.urlopen("http://127.0.0.1:8777/api/telefon", timeout=3) as r:
            d = json.loads(r.read().decode("utf-8") or "{}")
        return {"ishlayapti": True, "manzillar": d.get("manzillar") or [], "pin": str(d.get("pin") or "")}
    except urllib.error.HTTPError:
        return {"ishlayapti": True, "manzillar": [], "pin": ""}
    except Exception:
        return {"ishlayapti": False}


def ai_jarayonlar():
    import subprocess
    papka = AI_PAPKA.rstrip("\\") + "\\*"
    # venv'dagi python.exe (ishga tushiruvchi) - taskkill /t uning bolasi (asl python) bilan birga to'xtatadi
    buyruq = ("Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'python*' -and "
              "$_.ExecutablePath -like '%s' } | ForEach-Object { $_.ProcessId }") % papka
    out = subprocess.run(["powershell", "-NoProfile", "-Command", buyruq], capture_output=True,
                         creationflags=NO_WINDOW, timeout=30).stdout.decode("utf-8", "ignore")
    return [int(x) for x in out.split() if x.isdigit()]


def ai_yoq():
    import subprocess
    if ai_holat()["ishlayapti"]:
        return {"ok": True, "ai": ai_holat()}
    py = os.path.join(AI_PAPKA, ".venv", "Scripts", "python.exe")
    if not os.path.exists(py):
        return {"ok": False, "xato": "AI Studio topilmadi (" + AI_PAPKA + ")"}
    jurnal = open(os.path.join(AI_PAPKA, "malumot", "server-bot.log"), "ab")
    subprocess.Popen([py, "server.py"], cwd=AI_PAPKA, stdout=jurnal, stderr=jurnal, stdin=subprocess.DEVNULL,
                     creationflags=NO_WINDOW | 0x00000200)  # CREATE_NEW_PROCESS_GROUP
    for _ in range(60):
        time.sleep(2)
        h = ai_holat()
        if h["ishlayapti"]:
            time.sleep(2)  # telefon (HTTPS) qismi ham ko'tarilsin
            return {"ok": True, "ai": ai_holat()}
    return {"ok": False, "xato": "2 daqiqada ishga tushmadi (malumot/server-bot.log ga qarang)", "ai": ai_holat()}


def ai_ochir():
    import subprocess
    for pid in ai_jarayonlar():
        subprocess.run(["taskkill", "/pid", str(pid), "/t", "/f"], capture_output=True, creationflags=NO_WINDOW)
    for _ in range(10):
        time.sleep(1)
        if not ai_holat()["ishlayapti"]:
            return {"ok": True, "ai": {"ishlayapti": False}}
    return {"ok": False, "xato": "to'xtamadi", "ai": ai_holat()}


# ------------------------------------------------------------------ Telegram Desktop qulfini (kod-parol) ochish
# Bot "▶ Telegram — yoqish" bosilsa agent Telegram'ni "KA_telegram" vazifasi orqali ochadi (ota jarayoni
# svchost.exe - Task Scheduler). Faqat SHUNDAY yangi ochilgan Telegram oynasiga kod-parol kiritiladi;
# kompyuterda o'zingiz ochgan Telegram (ota - explorer.exe) qulfligicha qoladi.
# Kod-parol git'da emas: %LOCALAPPDATA%\ClaudeTelegram\telegram-kod.txt (yo'q bo'lsa - hech narsa qilinmaydi).
TG_KOD_FAYL = os.environ.get("CLAUDE_TG_KOD_FAYL") or os.path.join(
    os.environ.get("LOCALAPPDATA", ""), "ClaudeTelegram", "telegram-kod.txt")


def jarayonlar():
    """[(pid, ota_pid, exe_nomi)] - Toolhelp32 snapshot."""
    from ctypes import wintypes

    class PE(ctypes.Structure):
        _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD), ("th32ProcessID", wintypes.DWORD),
                    ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", wintypes.DWORD),
                    ("cntThreads", wintypes.DWORD), ("th32ParentProcessID", wintypes.DWORD),
                    ("pcPriClassBase", ctypes.c_long), ("dwFlags", wintypes.DWORD), ("szExeFile", ctypes.c_wchar * 260)]

    k32 = ctypes.windll.kernel32
    k32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    snap = k32.CreateToolhelp32Snapshot(2, 0)
    natija = []
    e = PE()
    e.dwSize = ctypes.sizeof(PE)
    ok = k32.Process32FirstW(snap, ctypes.byref(e))
    while ok:
        natija.append((e.th32ProcessID, e.th32ParentProcessID, e.szExeFile.lower()))
        ok = k32.Process32NextW(snap, ctypes.byref(e))
    k32.CloseHandle(snap)
    return natija


def jarayon_oynasi(pid):
    from ctypes import wintypes
    u32 = ctypes.windll.user32
    topildi = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def cb(hwnd, _):
        p = wintypes.DWORD()
        u32.GetWindowThreadProcessId(hwnd, ctypes.byref(p))
        if p.value == pid and u32.IsWindowVisible(hwnd) and u32.GetWindowTextLengthW(hwnd) > 0:
            topildi.append(hwnd)
            return False
        return True

    u32.EnumWindows(cb, 0)
    return topildi[0] if topildi else None


def telegram_kodni_kirit(pid, kod):
    u32 = ctypes.windll.user32
    hwnd = None
    for _ in range(30):  # oyna chiqishini kutamiz
        hwnd = jarayon_oynasi(pid)
        if hwnd:
            break
        time.sleep(1)
    if not hwnd:
        return
    time.sleep(2.5)  # kod-parol oynasi chizilsin
    u32.ShowWindow(hwnd, 9)  # SW_RESTORE
    u32.keybd_event(0x12, 0, 0, 0)  # Alt bosib qo'yish - fon jarayoniga SetForegroundWindow ruxsat beradi
    u32.SetForegroundWindow(hwnd)
    u32.keybd_event(0x12, 0, 2, 0)
    time.sleep(0.7)
    if u32.GetForegroundWindow() != hwnd:
        return  # oyna oldinga chiqmadi - boshqa joyga yozib yubormaslik uchun to'xtaymiz
    for ch in kod:
        vk = ord(ch.upper())
        u32.keybd_event(vk, 0, 0, 0)
        u32.keybd_event(vk, 0, 2, 0)
        time.sleep(0.05)
    u32.keybd_event(0x0D, 0, 0, 0)
    u32.keybd_event(0x0D, 0, 2, 0)


def telegram_qulf_tsikl():
    korilgan = {pid for pid, _o, nom in jarayonlar() if nom == "telegram.exe"}  # oldindan ochiqlar - tegmaymiz
    while True:
        time.sleep(3)
        try:
            royxat = jarayonlar()
            nomlar = {pid: nom for pid, _o, nom in royxat}
            for pid, ota, nom in royxat:
                if nom != "telegram.exe" or pid in korilgan:
                    continue
                korilgan.add(pid)
                if nomlar.get(ota) != "svchost.exe":
                    continue  # bot orqali (Task Scheduler) ochilmagan
                try:
                    with open(TG_KOD_FAYL, encoding="utf-8") as f:
                        kod = f.read().strip()
                except OSError:
                    continue
                if kod.isalnum():
                    telegram_kodni_kirit(pid, kod)
            korilgan &= set(nomlar)
        except Exception:
            pass


# ------------------------------------------------------------------ 🛡 Botlar: shu kompyuterdagi botlar
# Server (botlar.js) holatni har 30 s oladi va ▶/⏹/♻️ buyruqlarini /vs-kut orqali yuboradi.
KOMPYUTER_BOTLAR = {
    "jarvis": {
        "papka": r"D:\jarvis",  # shu papkadagi .venv python jarayonlari - bot (fon.py nazoratchisi + bot.py)
        "belgi": "bot.py",  # ishlayapti = buyruq qatorida shu bor jarayon bor
        "log": r"D:\jarvis\malumot\jarvis.log",
        "yoqish": ["wscript.exe", r"D:\jarvis\jarvis_fonda.vbs"],
        "tiklash": True,  # kompyuter yoniq ekan doim ishlasin: to'xtab qolsa kuzatuvchi o'zi qayta yoqadi
    },
    "pultcam": {  # Kamera AI (@Pultcam): o'rnatilgan dastur, Windows'ga kirganda Startup'dan yonadi
        "papka": os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "KameraAI"),
        "exe": "KameraAI*",
        "belgi": "KameraAI",
        "log": os.path.join(os.environ.get("LOCALAPPDATA", ""), "KameraAI", "dastur.log"),
        "yoqish": [os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "KameraAI", "KameraAI.exe"), "--oynasiz", "--fon"],
        "tiklash": True,
    },
    "pult": {  # Control Pult (BoshqaruvPulti): boti pult.py ichida ishlaydi; oynasiz (--oynasiz) yoqiladi
        "papka": r"D:\BoshqaruvPulti\dastur",
        "cmd": r"*BoshqaruvPulti\dastur\pult.py*",  # tizim Python'i bilan ishlaydi - buyruq qatori bo'yicha topiladi
        "belgi": "pult.py",
        "log": os.path.join(r"D:\BoshqaruvPulti\dastur", "zakaz_avto_" + os.environ.get("COMPUTERNAME", "") + ".log"),
        "yoqish": [os.path.join(os.path.dirname(sys.executable), "pythonw.exe"), r"D:\BoshqaruvPulti\dastur\pult.py", "--oynasiz"],
        "tiklash": True,
    },
}
_toxtatilgan = set()  # bot orqali ataylab to'xtatilganlar - o'zi qayta yoqilmaydi
_jim_sanoq = {}  # nom -> ketma-ket "ishlamayapti" tekshiruvlari


def papka_jarayonlari(papka, exe="python*", cmd=None):
    """[(pid, buyruq_qatori)] - exe shu papka ichida bo'lgan jarayonlar (standart: python);
    cmd berilsa - buyruq qatori shu naqshga mos python jarayonlari."""
    import subprocess
    naqsh = papka.rstrip("\\") + "\\*"
    shart = ("$_.CommandLine -like '%s'" % cmd) if cmd else ("$_.ExecutablePath -like '%s'" % naqsh)
    buyruq = ("Get-CimInstance Win32_Process | Where-Object { $_.Name -like '%s' -and %s } | "
              "ForEach-Object { '' + $_.ProcessId + '|' + $_.CommandLine }") % (exe, shart)
    out = subprocess.run(["powershell", "-NoProfile", "-Command", buyruq], capture_output=True,
                         creationflags=NO_WINDOW, timeout=30).stdout.decode("utf-8", "ignore")
    natija = []
    for q in out.splitlines():
        pid, _, cmd = q.partition("|")
        if pid.strip().isdigit():
            natija.append((int(pid), cmd))
    return natija


def log_dumi(yol, n=15):
    try:
        with open(yol, "rb") as f:
            f.seek(0, 2)
            f.seek(max(0, f.tell() - 8000))
            qator = f.read().decode("utf-8", "replace").splitlines()
        return "\n".join(qator[-n:])
    except OSError:
        return ""


def _ishlayaptimi(c):
    return any(c["belgi"] in cmd for _p, cmd in papka_jarayonlari(c["papka"], c.get("exe", "python*"), c.get("cmd")))


def kompyuter_botlar_holati():
    """Har 30 s: holat + log. "tiklash" botlari 2 tekshiruv (≈1 daqiqa) ishlamasa - o'zi qayta yoqiladi."""
    natija = {}
    for nom, c in KOMPYUTER_BOTLAR.items():
        if not os.path.isdir(c["papka"]):
            continue
        ish = _ishlayaptimi(c)
        _jim_sanoq[nom] = 0 if ish else _jim_sanoq.get(nom, 0) + 1
        if not ish and c.get("tiklash") and nom not in _toxtatilgan and _jim_sanoq[nom] >= 2:
            _jim_sanoq[nom] = -6  # yoqilgach ~3 daqiqa kutamiz, takror-takror urinmasin
            try:
                import subprocess
                subprocess.Popen(c["yoqish"], cwd=c["papka"], creationflags=NO_WINDOW)
            except Exception:
                pass
        natija[nom] = {"ishlayapti": ish, "log": log_dumi(c["log"])}
    return natija


def kompyuter_bot_amal(nom, qil):
    import subprocess
    c = KOMPYUTER_BOTLAR.get(nom)
    if not c or qil not in ("start", "stop", "restart"):
        return {"ok": False, "xato": "noma'lum bot yoki buyruq"}
    exe = c.get("exe", "python*")
    if qil == "stop":
        _toxtatilgan.add(nom)
    else:
        _toxtatilgan.discard(nom)
    if qil in ("stop", "restart"):
        for pid, _cmd in papka_jarayonlari(c["papka"], exe, c.get("cmd")):
            subprocess.run(["taskkill", "/pid", str(pid), "/t", "/f"], capture_output=True, creationflags=NO_WINDOW)
        time.sleep(2)
    if qil in ("start", "restart"):
        if _ishlayaptimi(c):
            return {"ok": True}
        subprocess.Popen(c["yoqish"], cwd=c["papka"], creationflags=NO_WINDOW)
        for _ in range(20):
            time.sleep(2)
            if _ishlayaptimi(c):
                return {"ok": True}
        return {"ok": False, "xato": "40 soniyada ishga tushmadi"}
    ok = not papka_jarayonlari(c["papka"], exe, c.get("cmd"))
    return {"ok": ok, "xato": "" if ok else "to'xtamadi"}


def vs_tsikl():
    """POST /vs-kut long-poll: "🧩 VS Code" tugmasidan buyruq kelsa - sessiyani ochadi."""
    kutish = 5
    while True:
        try:
            b = post("/vs-kut", {}, timeout=45).get("buyruq")
            kutish = 5
        except Exception:
            time.sleep(kutish)
            kutish = min(kutish * 2, 60)
            continue
        if not b:
            continue
        sid = str(b.get("sid", ""))
        amal = b.get("amal")
        try:
            if amal == "ai-yoq":
                r = ai_yoq()
            elif amal == "ai-ochir":
                r = ai_ochir()
            elif amal == "ai-holat":
                r = {"ok": True, "ai": ai_holat()}
            elif amal == "bot":
                r = kompyuter_bot_amal(str(b.get("nom", "")), str(b.get("qil", "")))
            elif len(sid) != 36:
                r = {"ok": False, "xato": "noto'g'ri sessiya"}
            elif b.get("amal") == "yop":
                r = sessiyani_yop(sid)
            else:
                r = vscode_och(sid)
        except Exception as e:
            r = {"ok": False, "xato": str(e)}
        try:
            post("/vs-natija", {"id": b.get("id"), **r}, timeout=15)
        except Exception:
            pass


def rejim_kuzat():
    """Doimiy fon jarayoni (pythonw, Windows'ga kirganda avtomatik - HKCU Run "ClaudeTelegramKuzat").
    Har 30 s Claude Code'ning ochiq sessiyalar ro'yxatini (va so'nggi sessiyalarni - "🧩 VS Code" uchun)
    serverga yuboradi: yopilgan/tugagan sessiya ro'yxatdan darrov tushadi, hook hali ishlamagan sessiya
    qo'shiladi. Alohida oqimda VS Code'da sessiya ochish buyruqlarini kutadi. Bitta nusxa (mutex)."""
    import threading
    ctypes.windll.kernel32.CreateMutexW(None, False, "Local\\ClaudeTelegramKuzat")
    if ctypes.windll.kernel32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
        return
    threading.Thread(target=vs_tsikl, daemon=True).start()
    threading.Thread(target=telegram_qulf_tsikl, daemon=True).start()
    while True:
        data = {}
        r = jonli_sessiyalar()
        if r is not None:
            data["royxat"] = r
        try:
            data["songgi"] = [{k: v for k, v in x.items() if k != "cwd"} for x in songgi_sessiyalar()]
        except Exception:
            pass
        try:
            data["ai"] = ai_holat()
        except Exception:
            pass
        try:
            data["botlar"] = kompyuter_botlar_holati()
        except Exception:
            pass
        lim = limit_oqi()  # 📊 Claude limitlari (statusLine yozgan)
        if lim:
            data["claude_limit"] = lim
        if data:
            try:
                post("/holat", data, timeout=15)
            except Exception:
                pass
        time.sleep(30)


# ------------------------------------------------------------------ 📊 Claude limitlari (statusLine orqali)
# Claude Code status qatoriga (settings.json "statusLine") rasmiy rate_limits beradi: five_hour / seven_day
# used_percentage va resets_at. Shu yerda faylga yoziladi; kuzatuvchi uni serverga (@claude_asadbek_bot) yuboradi.
# Kirish kaliti o'qilmaydi - faqat Claude Code'ning o'zi bergan foizlar.
LIMIT_FAYL = os.path.join(HOLAT_PAPKA, "limit.json")


def rejim_statusline():
    try:
        d = json.loads(sys.stdin.buffer.read().decode("utf-8") or "{}")
    except Exception:
        d = {}
    rl = d.get("rate_limits") or {}
    qism = []
    if rl:
        yoz = {"vaqt": int(time.time())}
        for k in ("five_hour", "seven_day"):
            w = rl.get(k) or {}
            if w.get("used_percentage") is not None:
                yoz[k] = {"foiz": float(w["used_percentage"]), "tiklanadi": w.get("resets_at")}
        try:
            os.makedirs(HOLAT_PAPKA, exist_ok=True)
            vaqtinch = LIMIT_FAYL + ".tmp"
            with open(vaqtinch, "w", encoding="utf-8") as f:
                json.dump(yoz, f)
            os.replace(vaqtinch, LIMIT_FAYL)
        except Exception:
            pass
        if "seven_day" in yoz:
            qism.append(f"Hafta {yoz['seven_day']['foiz']:.0f}%")
        if "five_hour" in yoz:
            qism.append(f"5 soat {yoz['five_hour']['foiz']:.0f}%")
    model = (d.get("model") or {}).get("display_name") or ""
    sys.stdout.buffer.write(" · ".join([x for x in [model] + qism if x]).encode("utf-8"))


def limit_oqi():
    try:
        with open(LIMIT_FAYL, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def main():
    if os.environ.get("PM_TELEGRAM_APPROVAL_ENABLED") == "0":
        return
    rejim = sys.argv[1] if len(sys.argv) > 1 else ""
    if rejim == "statusline":
        return rejim_statusline()
    if rejim == "kuzat":
        return rejim_kuzat() if kalit() else None
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
