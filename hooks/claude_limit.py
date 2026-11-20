"""
📊 Claude limiti (haftalik va 5 soatlik %) - VS Code'dagi Claude "Account & Usage" oynasidagi bilan bir xil manba.

Kompyuterdagi Claude login tokeni (~/.claude/.credentials.json) bilan FAQAT Anthropic'ning o'z serveriga
(api.anthropic.com/api/oauth/usage) so'rov yuboriladi. Token hech qayerga yozilmaydi va chiqarilmaydi.
Natija (faqat foizlar va tiklanish vaqti) ~/.claude/tg-sessiya/limit.json ga yoziladi; kuzatuvchi
(claude_telegram.py kuzat) uni @claude_asadbek_bot ga yuboradi.

Ishga tushirish: python claude_limit.py   (chiqish: "ok hafta N% · 5 soat M%" yoki "xato: ...")
"""
import json
import os
import sys
import time
import urllib.request
from datetime import datetime

LIMIT_FAYL = os.path.join(os.path.expanduser("~"), ".claude", "tg-sessiya", "limit.json")
MANBA = "https://api.anthropic.com/api/oauth/usage"


def _sek(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return int(v)
    try:
        return int(datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp())
    except Exception:
        return None


def _foiz(w):
    if not isinstance(w, dict):
        return None
    for k in ("utilization", "used_percentage", "percent"):
        if w.get(k) is not None:
            return float(w[k])
    return None


def ol():
    with open(os.path.join(os.path.expanduser("~"), ".claude", ".credentials.json"), encoding="utf-8") as f:
        token = (json.load(f).get("claudeAiOauth") or {}).get("accessToken", "")
    if not token:
        raise RuntimeError("Claude'ga kirilmagan")
    req = urllib.request.Request(MANBA, headers={"Authorization": "Bearer " + token,
                                                 "anthropic-beta": "oauth-2025-04-20", "User-Agent": "claude-code"})
    d = json.loads(urllib.request.urlopen(req, timeout=20).read())
    natija = {"vaqt": int(time.time())}
    for k in ("five_hour", "seven_day"):
        f = _foiz(d.get(k))
        if f is not None:
            natija[k] = {"foiz": f, "tiklanadi": _sek((d.get(k) or {}).get("resets_at"))}
    if len(natija) == 1:
        raise RuntimeError("javobda foizlar topilmadi: " + ",".join(sorted(d.keys()))[:200])
    return natija


def saqla(natija):
    os.makedirs(os.path.dirname(LIMIT_FAYL), exist_ok=True)
    tmp = LIMIT_FAYL + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(natija, f)
    os.replace(tmp, LIMIT_FAYL)


if __name__ == "__main__":
    try:
        n = ol()
        saqla(n)
        q = []
        if "seven_day" in n:
            q.append(f"hafta {n['seven_day']['foiz']:.0f}%")
        if "five_hour" in n:
            q.append(f"5 soat {n['five_hour']['foiz']:.0f}%")
        print("ok " + " · ".join(q))
    except Exception as e:
        print(f"xato: {str(e)[:300]}")
        sys.exit(1)
