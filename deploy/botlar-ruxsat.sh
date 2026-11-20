#!/bin/bash
# 🛡 Botlar: Claude Asadbek botiga serverdagi boshqa botlarni boshqarish ruxsati (bir marta, root sifatida).
# Faqat shu xizmatlar uchun: start / stop / restart va loglarni o'qish. Boshqa hech narsa ruxsat etilmaydi.
# Ishlatish: ssh root@65.21.3.105 'bash -s' < deploy/botlar-ruxsat.sh
set -e
FOYD=$(systemctl show claude-asadbek-bot -p User --value)
if [ -z "$FOYD" ] || [ "$FOYD" = "root" ]; then
  echo "Bot root sifatida ishlaydi - qo'shimcha ruxsat kerak emas."
  exit 0
fi
XIZMATLAR="avtobot gps-nazorat bazis-usta"
QOIDA=""
for x in $XIZMATLAR; do
  for a in start stop restart; do
    QOIDA="$QOIDA /usr/bin/systemctl $a $x,"
  done
done
QOIDA=${QOIDA%,}
echo "$FOYD ALL=(root) NOPASSWD:$QOIDA" > /etc/sudoers.d/claude-asadbek-botlar
chmod 440 /etc/sudoers.d/claude-asadbek-botlar
visudo -cf /etc/sudoers.d/claude-asadbek-botlar
usermod -aG systemd-journal "$FOYD"   # loglarni o'qish
systemctl restart claude-asadbek-bot   # guruh o'zgarishi kuchga kirsin
echo "Tayyor: $FOYD endi $XIZMATLAR ni boshqara oladi."
