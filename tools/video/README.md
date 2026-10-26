# Hakkım AI — tanıtım videosu

`render-promo.js`, Hakkım AI için dikey (9:16) ve yatay (16:9) tanıtım videosu
üretir. Video; SVG sahnelerin `sharp` ile karelere rasterize edilmesi ve karelerin
doğrudan `ffmpeg`'e borulanmasıyla oluşur. Ses yatağı (pad + sahne geçiş vuruşları)
48 kHz stereo WAV olarak betik içinde sentezlenir; dışarıdan medya dosyası
kullanılmaz.

## Çıktılar

| Dosya | Boyut | Kullanım |
| --- | --- | --- |
| `assets/video/hakkim-ai-promo-9x16.mp4` | 1080×1920, 30 fps, 22,4 sn | Reels, TikTok, Shorts |
| `assets/video/hakkim-ai-promo-16x9.mp4` | 1920×1080, 30 fps, 22,4 sn | YouTube, LinkedIn, sunum |
| `assets/video/*-kapak.jpg` | 1080×1920 / 1920×1080 | Kapak görseli |
| `assets/video/hakkim-ai-promo.srt` | — | Türkçe altyazı |
| `assets/video/seslendirme.md` | — | Seslendirme metni + zaman kodları |

## Üretim

```bash
cd tools/video
./build.sh            # bağımlılıkları kurar, iki videoyu ve kapakları üretir
```

Tek format:

```bash
node render-promo.js --format vertical --out ../../assets/video/test.mp4
node render-promo.js --format wide --out ../../assets/video/test.mp4
```

Tek kare önizleme (hızlı tasarım kontrolü):

```bash
node render-promo.js --format vertical --still 12.5 --out /tmp/kare.png
```

Seçenekler: `--fps`, `--crf`, `--silent`, `--duration <sn>` (kısa deneme çıktısı),
`--poster <jpg>`, `--poster-time <sn>`, `--bench` (kare başına süre ölçümü).
`FFMPEG=/yol/ffmpeg` ile sistem ffmpeg'i zorlanabilir; aksi halde `ffmpeg-static`
ya da `PATH` kullanılır.

## Zaman çizelgesi

| Aralık | Sahne | İçerik |
| --- | --- | --- |
| 0,0–3,3 sn | Açılış | Logo, marka, "Tüketici hakları vaka asistanı", V0.10 rozeti |
| 3,3–8,1 sn | Sorun | "Hakkın var. Ama nereden başlayacaksın?" + üç soru |
| 8,1–14,3 sn | Ürün | Uygulama ekranı: yazılan açıklama, analiz sonucu, SHA-256 özeti |
| 14,3–18,7 sn | Özellikler | AES-GCM, PBKDF2, SHA-256, JSON yedek, hatırlatma, PWA/offline |
| 18,7–22,4 sn | Kapanış | "Sen uğraşma, hakkını o takip etsin." + adres + sorumluluk notu |

## Tasarım notları

- Palet ve tipografi `style.css` ile aynıdır: `#07111f`, `#101e31`, `#223a57`,
  `#f5f7fb`, `#9bb0c9`, vurgu `#60e4b6`.
- Tüm metinler `fonts/` altındaki Roboto ile çizilir; `render-promo.js`
  `FONTCONFIG_FILE` değişkenini kendisi ayarlar, ek kurulum gerekmez.
- Metinler sahnelerde animasyonlu girer (fade + hafif kayma/ölçek). Kare üretimi
  deterministiktir: aynı betik aynı videoyu verir.
- Vurgulanan işlevler uygulamanın gerçek V0.10 kapsamıyla sınırlıdır; videoda
  banka/e-Devlet şifresi gibi hassas veri istenmez.

## Lisans

`fonts/` altındaki Roboto yazı tipleri Apache License 2.0 ile dağıtılır
(bkz. `fonts/LICENSE.txt`). `sharp` (Apache-2.0) ve `ffmpeg-static` (GPL/LGPL
yapılandırması) kendi lisanslarına tabidir; video çıktısı bu araçlarla üretilen
normal bir eserdir.
