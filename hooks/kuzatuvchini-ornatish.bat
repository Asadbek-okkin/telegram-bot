@echo off
rem Claude Code sessiyalari kuzatuvchisini o'rnatadi: Windows'ga kirganda o'zi ishga tushadi va hozir ham ishga tushiradi.
rem Har 30 soniyada ochiq sessiyalar ro'yxatini @claude_asadbek_bot serveriga yuboradi (tugagan sessiya ro'yxatdan tushadi).
rem O'chirish: reg delete HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v ClaudeTelegramKuzat /f
set PYW=C:\Users\admin\AppData\Local\Programs\Python\Python314\pythonw.exe
set SKR=C:\Users\admin\telegram-bot\hooks\claude_telegram.py
reg add HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v ClaudeTelegramKuzat /t REG_SZ /d "\"%PYW%\" \"%SKR%\" kuzat" /f
start "" "%PYW%" "%SKR%" kuzat
echo Kuzatuvchi o'rnatildi va ishga tushdi.
pause
