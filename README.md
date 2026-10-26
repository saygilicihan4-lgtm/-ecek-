# Hakkım AI — Açık Beta

## Canlı uygulama
**https://hakkim-ai-pilot.vercel.app/**

Bu adres GitHub deposunun `main` dalından Vercel'e yayımlanır. Kaynak dosyalar bu depodadır.

- `index.html`: statik kullanıcı arayüzü
- `app.js`: cihaz içinde çalışan vaka işlemleri
- `style.css`: stil
- `manifest.webmanifest`: PWA tanımı

## Durum ve güvenlik
Bu sürüm **local-first açık beta**dır: vaka bilgileri varsayılan olarak tarayıcı içinde saklanır. Üretim backend'i veya hukuki danışmanlık hizmeti olarak sunulmaz. e-Devlet/banka şifreleri, kart bilgileri veya kimlik fotoğraflarını girmeyin. Başvuru yolları değişebilir; resmî kurumun güncel talimatları kontrol edilmelidir.

## Dağıtım
Vercel projesi: `hakkim-ai-pilot`, üretim dalı: `main`.
GitHub Pages henüz etkin değil; bu nedenle artık birincil erişim için `raw.githack.com` veya `github.io` adresleri kullanılmıyor. GitHub Pages workflow'u yalnız elle başlatılabilen alternatif olarak korunmuştur.
