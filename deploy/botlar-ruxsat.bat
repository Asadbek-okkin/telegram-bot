@echo off
chcp 65001 >nul
echo 🛡 Claude Asadbek botiga serverdagi botlarni boshqarish ruxsati beriladi (bir marta).
echo Faqat Avtobot, GPS, BazisUsta xizmatlarini yoqish/to'xtatish/qayta ishga tushirish va loglarini o'qish.
echo.
ssh -i "%USERPROFILE%\.ssh\inok_deploy" root@65.21.3.105 "bash /opt/claude-asadbek-bot/deploy/botlar-ruxsat.sh"
echo.
echo Tugadi. Bot 10 soniyada qayta ishga tushadi - keyin 🛡 Botlar ni qayta oching.
pause
