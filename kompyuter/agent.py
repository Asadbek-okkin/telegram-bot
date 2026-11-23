"""
Kompyuter agenti - @claude_asadbek_bot (Hetzner) shu kompyuter yoniqligini ko'rishi va uni o'chirishi uchun.

Kompyuterga tashqaridan hech kim ulanmaydi: agentning o'zi serverga chiqib turadi (long-poll).
  POST https://inok.uz/claude-pc/aloqa   X-Kalit: <kalit.txt>
       body: {holat: {...}, natija: <oldingi buyruq natijasi yoki null>}
       javob: {buyruq: null | {id, amal: "ochir"|"bekor", kechikish}}  (server buyruq bo'lmasa ~25 s ushlab turadi)
Agent so'rov yuborib turgan ekan - bot kompyuterni "yoniq" deb biladi.

Ishga tushirish: pythonw agent.py  (ornatish.ps1 Windows yoqilganda SYSTEM nomidan avtomatik ishga tushiradi)
"""
import ctypes
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request

SERVER = os.environ.get("KOMPYUTER_SERVER") or "https://inok.uz/claude-pc/aloqa"
PAPKA = os.path.dirname(os.path.abspath(__file__))
KALIT_FAYL = os.path.join(PAPKA, "kalit.txt")
JURNAL = os.path.join(PAPKA, "agent.log")
NO_WINDOW = 0x08000000  # CREATE_NO_WINDOW

holat = {"ochirish_vaqti": None}  # rejalashtirilgan o'chirish (unix vaqt) yoki None


def jurnal(matn):
    try:
        if os.path.exists(JURNAL) and os.path.getsize(JURNAL) > 1_000_000:
            os.replace(JURNAL, JURNAL + ".old")
        with open(JURNAL, "a", encoding="utf-8") as f:
            f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + matn + "\n")
    except OSError:
        pass


def kalit():
    try:
        with open(KALIT_FAYL, encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def yoniq_s():
    ctypes.windll.kernel32.GetTickCount64.restype = ctypes.c_ulonglong
    return int(ctypes.windll.kernel32.GetTickCount64() // 1000)


def foydalanuvchilar():
    """'query user' -> [{ism, holat, idle}]; hech kim kirmagan bo'lsa []."""
    try:
        # rus Windows'da konsol chiqishi OEM kodlashda (cp866): "Активно", "Диск"
        out = subprocess.run(["query", "user"], capture_output=True, timeout=10,
                             creationflags=NO_WINDOW).stdout.decode("oem", errors="replace")
    except Exception:
        return []
    natija = []
    for qator in out.splitlines()[1:]:
        q = qator.lstrip(">").split()
        if len(q) < 5:
            continue
        if q[2].isdigit():  # SESSIONNAME bor
            ism, holat_, idle = q[0], q[3], q[4]
        else:  # SESSIONNAME bo'sh (uzilgan sessiya) - ustunlar bittaga siljiydi
            ism, holat_, idle = q[0], q[2], q[3]
        natija.append({"ism": ism, "holat": holat_, "idle": idle})
    return natija


def holat_json():
    s = yoniq_s()
    oc = holat["ochirish_vaqti"]
    if oc and oc < time.time() - 120:
        oc = holat["ochirish_vaqti"] = None
    return {
        "kompyuter": socket.gethostname(),
        "yoniq_s": s,
        "boshlangan": time.strftime("%Y-%m-%d %H:%M", time.localtime(time.time() - s)),
        "foydalanuvchilar": foydalanuvchilar(),
        "ochirish": int(oc) if oc else None,
        "dasturlar": {n: ishlayaptimi(e) for n, e in DASTURLAR.items()},
    }


def ochir(kechikish, qayta=False):
    kechikish = max(0, min(int(kechikish), 3600))
    subprocess.run(["shutdown", "/a"], capture_output=True, creationflags=NO_WINDOW)  # eski rejani almashtiramiz
    r = subprocess.run(["shutdown", "/r" if qayta else "/s", "/f", "/t", str(kechikish), "/c",
                        "Telegram bot orqali " + ("qayta yuklanmoqda" if qayta else "o'chirilmoqda")
                        + ". Bekor qilish: botdagi 'Bekor qilish' tugmasi."],
                       capture_output=True, text=True, creationflags=NO_WINDOW)
    if r.returncode == 0:
        holat["ochirish_vaqti"] = time.time() + kechikish
        jurnal(f"o'chirish {kechikish} s dan keyin")
        return {"ok": True, "kechikish": kechikish}
    jurnal(f"o'chirish xatosi: {r.returncode} {r.stderr.strip()}")
    return {"ok": False, "xato": (r.stderr or r.stdout).strip() or f"kod {r.returncode}"}


def bekor():
    r = subprocess.run(["shutdown", "/a"], capture_output=True, text=True, creationflags=NO_WINDOW)
    rejada_edi = holat["ochirish_vaqti"] is not None
    holat["ochirish_vaqti"] = None
    jurnal("o'chirish bekor qilindi")
    return {"ok": r.returncode == 0 or not rejada_edi, "rejada_edi": rejada_edi}


# Dasturlar: yoqish - foydalanuvchi sessiyasidagi "KA_<nom>" vazifasi orqali (agent SYSTEM nomidan ishlaydi,
# o'zi ekranga oyna ocholmaydi); yopish - taskkill (avval yumshoq: saqlash oynasi chiqishi mumkin).
DASTURLAR = {"yandex": "browser.exe", "telegram": "Telegram.exe", "bazis": "Bazis.exe", "1c": "1cv8c.exe"}


def ishlayaptimi(exe):
    out = subprocess.run(["tasklist", "/fi", f"imagename eq {exe}", "/nh"], capture_output=True,
                         creationflags=NO_WINDOW).stdout.decode("oem", errors="replace")
    return exe.lower() in out.lower()


def dastur(nom, qil):
    exe = DASTURLAR.get(nom)
    if not exe:
        return {"ok": False, "xato": f"noma'lum dastur: {nom}"}
    if qil == "yoq":
        r = subprocess.run(["schtasks", "/run", "/tn", f"KA_{nom}"], capture_output=True, creationflags=NO_WINDOW)
        time.sleep(4)
        ok = r.returncode == 0 and ishlayaptimi(exe)
        jurnal(f"dastur yoq {nom}: {ok}")
        return {"ok": ok, "xato": "" if ok else "ishga tushmadi (Windows'ga kirilmaganmi?)"}
    imgs = [exe] + (["1cv8.exe", "1cestart.exe"] if nom == "1c" else [])
    # Telegram/Yandex yopilganda trayga yashirinadi va saqlanmagan ish yo'q - ular darrov majburan yopiladi
    if nom in ("telegram", "yandex"):
        qil = "majburan"
    if qil != "majburan":
        # yumshoq yopish (WM_CLOSE) boshqa sessiyadan ishlamaydi - foydalanuvchi sessiyasidagi KA_yop_<nom> vazifasi
        subprocess.run(["schtasks", "/run", "/tn", f"KA_yop_{nom}"], capture_output=True, creationflags=NO_WINDOW)
        for _ in range(8):
            time.sleep(1)
            if not ishlayaptimi(exe):
                break
    if qil == "majburan" or not ishlayaptimi(exe):
        for i in imgs:
            subprocess.run(["taskkill", "/f", "/im", i], capture_output=True, creationflags=NO_WINDOW)
        time.sleep(1)
    ok = not ishlayaptimi(exe)
    jurnal(f"dastur {qil} {nom}: {ok}")
    return {"ok": ok, "xato": "" if ok else "yopilmadi - ekranda saqlash oynasi chiqqan bo'lishi mumkin"}


def bajar(buyruq):
    amal = buyruq.get("amal")
    if amal == "dastur":
        r = dastur(buyruq.get("nom"), buyruq.get("qil"))
    elif amal == "ochir":
        r = ochir(buyruq.get("kechikish", 60))
    elif amal == "qayta":  # 🔁 qayta yuklash (perezagruzka)
        r = ochir(buyruq.get("kechikish", 60), qayta=True)
    elif amal == "bekor":
        r = bekor()
    else:
        r = {"ok": False, "xato": f"noma'lum buyruq: {amal}"}
    return {**buyruq, **r}


def aloqa(k, natija):
    body = json.dumps({"holat": holat_json(), "natija": natija}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(SERVER, data=body, method="POST",
                                 headers={"X-Kalit": k, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.loads(r.read().decode("utf-8") or "{}")


def main():
    k = kalit()
    if not k:
        jurnal("kalit.txt yo'q - agent ishlamaydi")
        sys.exit(1)
    jurnal(f"agent ishga tushdi ({socket.gethostname()})")
    natija = None
    kutish = 5
    while True:
        try:
            javob = aloqa(k, natija)
            natija = None
            kutish = 5
            buyruq = javob.get("buyruq")
            if buyruq:
                natija = bajar(buyruq)
        except Exception as e:  # internet yo'q / server qayta ishga tushyapti - kutib qayta urinamiz
            jurnal(f"aloqa xatosi: {e}")
            time.sleep(kutish)
            kutish = min(kutish * 2, 60)


if __name__ == "__main__":
    main()
