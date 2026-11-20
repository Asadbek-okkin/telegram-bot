"""
🤝 Botni @claude_asadbek_bot jamoasiga ulash shabloni (faqat standart Python, kutubxona kerak emas).

Qanday ulanadi:
  1) Shu faylni botingiz papkasiga ko'chiring.
  2) Botingiz ishga tushganda (bir marta):

        import agent_shablon
        def mening_ishim(vazifa, kontekst):
            # vazifa - Claude Asadbek bergan topshiriq (matn); kontekst - oldingi botlar natijasi
            return "natija matni"          # botingiz o'z funksiyasi bilan bajaradi
        agent_shablon.boshla(mening_ishim, token=TELEGRAM_TOKEN, kalit="<agent kaliti>", port=8400)

  3) Telegram'da Claude Asadbek'ka shaxsiy chatda yozing:
        /bot_qosh Bot nomi | nima ish qiladi | http://SERVER:8400/agent
     U bergan "Agent kaliti"ni 2-qadamdagi kalit= ga yozing (botni qayta ishga tushiring).
  4) Botni "Avtobotlar" guruhiga qo'shing. Tayyor - majlis va vazifalarda qatnashadi.

Bot Claude Asadbek bilan bitta serverda bo'lsa url: http://127.0.0.1:8400/agent (tashqariga ochilmaydi).
Boshqa joyda bo'lsa - shu portga tashqaridan kirish (yoki nginx orqali https) kerak.
"""
import json
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def boshla(ish, token, kalit, port=8400, host="0.0.0.0"):
    def guruhga(guruh, matn):
        for i in range(0, len(matn), 4000):
            data = json.dumps({"chat_id": guruh, "text": matn[i:i + 4000]}).encode("utf-8")
            req = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=data,
                                         headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=30).read()

    class Eshik(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _javob(self, kod, obj):
            b = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(kod)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def do_GET(self):  # majlis davomati: "shu yerdaman"
            self._javob(200, {"ok": True})

        def do_POST(self):
            if kalit and self.headers.get("X-Agent-Kalit") != kalit:
                return self._javob(403, {"ok": False, "xato": "kalit noto'g'ri"})
            try:
                d = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
                matn = str(ish(str(d.get("vazifa", "")), str(d.get("kontekst", ""))) or "")
            except Exception as e:
                return self._javob(200, {"ok": False, "xato": str(e)[:300]})
            guruhga_ok = True
            if d.get("guruh") and matn:
                try:
                    guruhga(d["guruh"], matn)
                except Exception:
                    guruhga_ok = False
            self._javob(200, {"ok": True, "matn": matn, "guruhga": guruhga_ok})

    srv = ThreadingHTTPServer((host, port), Eshik)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    print(f"🤝 Agent eshigi: http://{host}:{port}/agent")
    return srv
