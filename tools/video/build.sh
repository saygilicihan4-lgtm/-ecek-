#!/usr/bin/env bash
# Hakkım AI tanıtım videosunu yeniden üretir (9:16 + 16:9 + kapak görselleri).
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "Bağımlılıklar kuruluyor (sharp + ffmpeg-static)…"
  npm install --no-audit --no-fund
  # Bazı npm sürümleri kurulum betiklerini engeller; ffmpeg ikilisini elle indir.
  if [ ! -x node_modules/ffmpeg-static/ffmpeg ]; then
    node node_modules/ffmpeg-static/install.js
  fi
fi

mkdir -p ../../assets/video
node render-promo.js --format vertical --out ../../assets/video/hakkim-ai-promo-9x16.mp4 \
  --poster ../../assets/video/hakkim-ai-promo-9x16-kapak.jpg
node render-promo.js --format wide --out ../../assets/video/hakkim-ai-promo-16x9.mp4 \
  --poster ../../assets/video/hakkim-ai-promo-16x9-kapak.jpg

echo "Hazır: assets/video/"
