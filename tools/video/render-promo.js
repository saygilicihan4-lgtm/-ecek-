#!/usr/bin/env node
/**
 * Hakkım AI — tanıtım videosu üreticisi
 *
 * Statik SVG kareleri sharp ile rasterize eder, kareleri doğrudan ffmpeg'e
 * borular ve üzerine cihazda üretilen yumuşak bir ses yatağı ekler.
 *
 * Kullanım:
 *   FONTCONFIG_FILE=./tools/video/fonts.conf FFMPEG=$(which ffmpeg) \
 *     node tools/video/render-promo.js --format vertical --out assets/video/hakkim-ai-promo-9x16.mp4
 *
 * Seçenekler:
 *   --format vertical|wide   (varsayılan: vertical)
 *   --out <dosya.mp4>
 *   --fps <sayı>             (varsayılan: 30)
 *   --crf <sayı>             (varsayılan: 19)
 *   --poster <dosya.jpg>     seçilen bir kareyi kapak görseli olarak yazar
 *   --silent                 ses yatağını eklemez
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

/* Fontlar depo içinde: libvips/fontconfig ilk kullanımdan önce yönlendirilir. */
const FONT_DIR = path.join(__dirname, 'fonts');
if (!process.env.FONTCONFIG_FILE && fs.existsSync(FONT_DIR)) {
  const cache = path.join(os.tmpdir(), 'hakkim-ai-fccache');
  const conf = path.join(os.tmpdir(), 'hakkim-ai-fonts.conf');
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(
    conf,
    `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig><dir>${FONT_DIR}</dir><cachedir>${cache}</cachedir></fontconfig>\n`
  );
  process.env.FONTCONFIG_FILE = conf;
}

/** ffmpeg: FFMPEG env → yerel ffmpeg-static → PATH. */
function resolveFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  try {
    const bundled = require('ffmpeg-static');
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch {
    /* ffmpeg-static kurulu değil */
  }
  return 'ffmpeg';
}

const sharp = require('sharp');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const flag = (name) => args.includes('--' + name);

const FPS = Number(opt('fps', 30));
const FORMAT = opt('format', 'vertical');
const FFMPEG = resolveFfmpeg();
const OUT = path.resolve(opt('out', `assets/video/hakkim-ai-promo-${FORMAT}.mp4`));
const POSTER = opt('poster', null);
const CRF = String(opt('crf', 19));
const SILENT = flag('silent');
const STILL = opt('still', null) === null ? null : Number(opt('still', 0));
const BENCH = flag('bench');

const DURATION = Number(opt('duration', 22.4));
const TOTAL = Math.round(DURATION * FPS);

/* ------------------------------------------------------------------ */
/* Tasarım sistemi — style.css ile aynı palet                          */
/* ------------------------------------------------------------------ */
const C = {
  panel: '#0d1b2c',
  panel2: '#08131f',
  line: '#223a57',
  line2: '#2a4a68',
  txt: '#f5f7fb',
  mut: '#9bb0c9',
  dim: '#7890aa',
  mint: '#60e4b6',
  mintInk: '#051a12',
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeBack = (t) => {
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};
const prog = (t, start, dur) => clamp((t - start) / dur, 0, 1);
const fadeIn = (t, start, dur = 0.55) => easeOut(prog(t, start, dur));
const fadeOut = (t, end, dur = 0.45) => 1 - easeOut(prog(t, end - dur, dur));
const vis = (t, start, end, durIn = 0.55, durOut = 0.4) =>
  Math.min(fadeIn(t, start, durIn), fadeOut(t, end, durOut));

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

const n = (v) => Number(v.toFixed(3));

/** Tek satır metin. */
function txt(x, y, size, weight, fill, content, o = {}) {
  const parts = [
    `x="${n(x)}"`,
    `y="${n(y)}"`,
    'font-family="Roboto"',
    `font-size="${size}"`,
    `font-weight="${weight}"`,
    `fill="${fill}"`,
  ];
  if (o.anchor) parts.push(`text-anchor="${o.anchor}"`);
  if (o.ls) parts.push(`letter-spacing="${o.ls}"`);
  if (o.op !== undefined && o.op < 1) parts.push(`opacity="${n(clamp(o.op, 0, 1))}"`);
  return `<text ${parts.join(' ')}>${esc(content)}</text>`;
}

/** Çok satırlı metin; satırlar tspan ile verilir. */
function lines(x, y, size, weight, fill, rows, o = {}) {
  const lh = o.lh || Math.round(size * 1.14);
  const spans = rows
    .map((r, i) => `<tspan x="${n(x)}" dy="${i === 0 ? 0 : lh}">${esc(r)}</tspan>`)
    .join('');
  const parts = [
    `x="${n(x)}"`,
    `y="${n(y)}"`,
    'font-family="Roboto"',
    `font-size="${size}"`,
    `font-weight="${weight}"`,
    `fill="${fill}"`,
  ];
  if (o.anchor) parts.push(`text-anchor="${o.anchor}"`);
  if (o.ls) parts.push(`letter-spacing="${o.ls}"`);
  return `<text ${parts.join(' ')}>${spans}</text>`;
}

/** Yuvarlatılmış panel. */
function panel(x, y, w, h, r, fill, stroke, strokeW = 2, extra = '') {
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${r}" fill="${fill}"${
    stroke ? ` stroke="${stroke}" stroke-width="${strokeW}"` : ''
  } ${extra}/>`;
}

/** Ortalanmış ölçek animasyonu. */
function zoomAt(cx, cy, s) {
  return `translate(${n(cx)} ${n(cy)}) scale(${n(s)}) translate(${n(-cx)} ${n(-cy)})`;
}

/* ------------------------------------------------------------------ */
/* Arka plan                                                           */
/* ------------------------------------------------------------------ */
function background(t, L) {
  const { W, H } = L;
  const drift = Math.sin(t * 0.32) * 40;
  const drift2 = Math.cos(t * 0.24) * 50;
  return `
  <defs>
    <linearGradient id="base" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="#0c2236"/>
      <stop offset="0.55" stop-color="#07121f"/>
      <stop offset="1" stop-color="#040b13"/>
    </linearGradient>
    <radialGradient id="glowA" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="${C.mint}" stop-opacity="0.22"/>
      <stop offset="0.55" stop-color="${C.mint}" stop-opacity="0.06"/>
      <stop offset="1" stop-color="${C.mint}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowB" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#2f7fa8" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#2f7fa8" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vignette" cx="50%" cy="46%" r="72%">
      <stop offset="0.45" stop-color="#02070c" stop-opacity="0"/>
      <stop offset="1" stop-color="#02070c" stop-opacity="0.72"/>
    </radialGradient>
    <pattern id="dots" width="44" height="44" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.5" fill="#79a3c4" opacity="0.5"/>
    </pattern>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#base)"/>
  <rect width="${W}" height="${H}" fill="url(#dots)" opacity="0.16"/>
  <ellipse cx="${n(W * 0.82 + drift)}" cy="${n(H * 0.14 - drift * 0.4)}" rx="${n(W * 0.66)}" ry="${n(W * 0.66)}" fill="url(#glowA)"/>
  <ellipse cx="${n(W * 0.1 + drift2)}" cy="${n(H * 0.86)}" rx="${n(W * 0.7)}" ry="${n(W * 0.7)}" fill="url(#glowB)"/>
  <rect width="${W}" height="${H}" fill="url(#vignette)"/>`;
}

function progressBar(t, L) {
  const p = clamp(t / DURATION, 0, 1);
  return `<rect x="0" y="${L.H - 7}" width="${n(L.W * p)}" height="7" fill="${C.mint}" opacity="0.45"/>`;
}

function logoMark(cx, cy, size, o = {}) {
  const s = size / 2;
  const r = size * 0.28;
  const op = o.op === undefined ? 1 : o.op;
  const scale = o.scale === undefined ? 1 : o.scale;
  const glyph = size * 0.56;
  return `<g opacity="${n(op)}" transform="${zoomAt(cx, cy, scale)}">
    <rect x="${n(cx - s)}" y="${n(cy - s)}" width="${n(size)}" height="${n(size)}" rx="${n(r)}" fill="${C.mint}"/>
    <text x="${n(cx)}" y="${n(cy + glyph * 0.36)}" font-family="Roboto" font-size="${n(glyph)}" font-weight="700" fill="${C.mintInk}" text-anchor="middle">H</text>
  </g>`;
}

/* ------------------------------------------------------------------ */
/* Sahte uygulama ekranı (yerel koordinat: 700 x 1150)                  */
/* ------------------------------------------------------------------ */
function phoneScreen(t) {
  const typedFull = 'Ürün bozuk çıktı, iade talebimi reddettiler.';
  const typedCount = Math.floor(clamp((t - 0.9) / 1.7, 0, 1) * typedFull.length);
  const typed = typedFull.slice(0, typedCount);
  const caretOn = (t * 2.4) % 1 < 0.6;
  const cardIn = fadeIn(t, 2.9, 0.7);
  const row = (delay) => fadeIn(t, 2.9 + delay, 0.6);
  const slide = (p, d = 22) => `translate(0 ${n((1 - p) * d)})`;

  const words = typed.split(' ');
  const out = [];
  let current = '';
  for (const w of words) {
    if ((current + ' ' + w).trim().length > 24) {
      out.push(current.trim());
      current = w;
    } else {
      current = (current + ' ' + w).trim();
    }
  }
  if (current) out.push(current);
  const caretLine = Math.max(0, out.length - 1);
  const caretX = clamp(62 + (out[out.length - 1] || '').length * 13.1, 62, 636);

  return `<g>
    ${panel(0, 0, 700, 1150, 60, C.panel2, C.line, 3)}
    <rect x="280" y="26" width="140" height="12" rx="6" fill="#1a2f47"/>

    <g opacity="${n(fadeIn(t, 0.1, 0.5))}">
      ${panel(40, 60, 46, 46, 13, C.mint, null)}
      <text x="63" y="94" font-family="Roboto" font-size="26" font-weight="700" fill="${C.mintInk}" text-anchor="middle">H</text>
      ${txt(98, 93, 27, 700, C.txt, 'Hakkım AI')}
      ${panel(494, 66, 170, 34, 17, 'none', '#2f5473', 1.6)}
      ${txt(579, 90, 16, 500, C.mint, 'LOCAL-FIRST', { anchor: 'middle', ls: 1.6 })}
    </g>
    <line x1="40" y1="132" x2="660" y2="132" stroke="#1c3049" stroke-width="2"/>

    ${txt(40, 182, 19, 700, C.dim, 'NE OLDU?', { ls: 4 })}
    ${panel(40, 200, 620, 182, 18, '#06101b', C.line, 2)}
    ${lines(62, 250, 27, 400, '#dbe6f2', out, { lh: 38 })}
    ${
      caretOn
        ? `<rect x="${n(caretX)}" y="${n(226 + 38 * caretLine)}" width="3" height="30" fill="${C.mint}" opacity="0.9"/>`
        : ''
    }
    ${txt(40, 416, 19, 700, C.dim, 'İSTEDİĞİN SONUÇ', { ls: 4 })}
    ${panel(40, 432, 620, 62, 16, '#06101b', C.line, 2)}
    ${txt(62, 472, 25, 500, '#c9d7e6', 'Para iadesi')}

    ${panel(40, 522, 620, 76, 16, C.mint, null)}
    ${txt(350, 571, 29, 700, C.mintInk, 'Vakayı analiz et', { anchor: 'middle' })}

    <g opacity="${n(cardIn)}" transform="${slide(cardIn, 26)}">
      ${panel(40, 640, 620, 452, 22, C.panel, C.line2, 2)}
      <rect x="40" y="640" width="9" height="452" rx="4" fill="${C.mint}"/>
      <g opacity="${n(row(0.1))}">
        ${txt(78, 686, 17, 700, C.dim, 'KATEGORİ', { ls: 3.4 })}
        ${txt(78, 726, 33, 700, C.txt, 'Ayıplı mal / iade')}
      </g>
      <line x1="78" y1="752" x2="622" y2="752" stroke="#1e3450" stroke-width="2"/>
      <g opacity="${n(row(0.28))}">
        ${txt(78, 796, 17, 700, C.dim, 'RESMÎ ROTA', { ls: 3.4 })}
        ${txt(78, 834, 29, 700, C.mint, 'Tüketici Hakem Heyeti')}
      </g>
      <g opacity="${n(row(0.46))}">
        ${txt(78, 886, 17, 700, C.dim, 'KANIT LİSTESİ', { ls: 3.4 })}
        ${txt(78, 920, 23, 500, '#d5e2ee', 'Fatura · Fotoğraf · Yazışma')}
      </g>
      <g opacity="${n(row(0.64))}">
        ${txt(78, 972, 17, 700, C.dim, 'SHA-256 KANIT ÖZETİ', { ls: 3.4 })}
        ${txt(78, 1006, 23, 500, C.mint, '9f2c41d8a7…b91e')}
      </g>
      <g opacity="${n(row(0.82))}">
        ${txt(78, 1064, 20, 500, C.mut, '2026 THH parasal sınırı: 186.000 TL')}
      </g>
    </g>

    <rect x="250" y="1112" width="200" height="8" rx="4" fill="#1e3550"/>
  </g>`;
}

/* ------------------------------------------------------------------ */
/* Sahne 1 — açılış                                                     */
/* ------------------------------------------------------------------ */
function sceneIntro(t, L) {
  const out = fadeOut(t, 3.25, 0.45);
  const logoP = clamp(prog(t, 0.15, 0.85), 0, 1);
  const logoScale = 0.72 + 0.28 * easeBack(logoP);
  const titleP = fadeIn(t, 0.62, 0.7);
  const tagP = fadeIn(t, 0.95, 0.7);
  const badgeP = fadeIn(t, 1.3, 0.7);
  const microP = fadeIn(t, 1.62, 0.7);

  if (L.wide) {
    return `<g opacity="${n(out)}">
      ${logoMark(960, 292, 190, { op: logoP, scale: logoScale })}
      <g opacity="${n(titleP)}" transform="translate(0 ${n((1 - titleP) * 26)})">
        ${txt(960, 545, 104, 700, C.txt, 'Hakkım AI', { anchor: 'middle', ls: -2 })}
      </g>
      <g opacity="${n(tagP)}">
        ${txt(960, 612, 40, 400, C.mut, 'Tüketici hakları vaka asistanı', { anchor: 'middle' })}
      </g>
      <g opacity="${n(badgeP)}">
        ${panel(690, 668, 540, 68, 34, '#071a19', '#2f6f5e', 1.8)}
        ${txt(960, 713, 24, 700, C.mint, 'V0.10 · LOCAL-FIRST BETA', { anchor: 'middle', ls: 5 })}
      </g>
      <g opacity="${n(microP)}">
        ${txt(960, 812, 26, 400, C.dim, 'Yerel · Şifreli · Kurulum yok', { anchor: 'middle' })}
      </g>
    </g>`;
  }

  return `<g opacity="${n(out)}">
    ${logoMark(540, 662, 236, { op: logoP, scale: logoScale })}
    <g opacity="${n(titleP)}" transform="translate(0 ${n((1 - titleP) * 30)})">
      ${txt(540, 962, 118, 700, C.txt, 'Hakkım AI', { anchor: 'middle', ls: -3 })}
    </g>
    <g opacity="${n(tagP)}">
      ${txt(540, 1038, 42, 400, C.mut, 'Tüketici hakları vaka asistanı', { anchor: 'middle' })}
    </g>
    <g opacity="${n(badgeP)}">
      ${panel(270, 1110, 540, 68, 34, '#071a19', '#2f6f5e', 1.8)}
      ${txt(540, 1155, 24, 700, C.mint, 'V0.10 · LOCAL-FIRST BETA', { anchor: 'middle', ls: 5 })}
    </g>
    <g opacity="${n(microP)}">
      ${txt(540, 1288, 28, 400, C.dim, 'Yerel · Şifreli · Kurulum yok', { anchor: 'middle' })}
    </g>
  </g>`;
}

/* ------------------------------------------------------------------ */
/* Sahne 2 — sorun                                                      */
/* ------------------------------------------------------------------ */
const QUESTIONS = [
  'Hangi kuruma başvuracağım?',
  'Hangi kanıtlar gerekiyor?',
  'Süreci nasıl takip edeceğim?',
];

function questionChip(x, y, w, h, index, p, L) {
  const size = L.wide ? 29 : 33;
  const iconR = L.wide ? 26 : 29;
  const iconCx = x + (L.wide ? 58 : 62);
  const cy = y + h / 2;
  return `<g opacity="${n(p)}" transform="translate(0 ${n((1 - p) * 34)})">
    ${panel(x, y, w, h, h / 2, 'rgba(16,32,52,0.85)', C.line, 2)}
    <circle cx="${n(iconCx)}" cy="${n(cy)}" r="${iconR}" fill="none" stroke="${C.mint}" stroke-width="2.2" opacity="0.8"/>
    ${txt(iconCx, cy + iconR * 0.34, L.wide ? 26 : 29, 700, C.mint, '?', { anchor: 'middle' })}
    ${txt(iconCx + iconR + (L.wide ? 26 : 30), cy + size * 0.35, size, 500, '#e3ecf5', QUESTIONS[index])}
  </g>`;
}

function sceneProblem(t, L) {
  const out = fadeOut(t, 4.75, 0.4);
  const eye = fadeIn(t, 0.2, 0.6);
  const l1 = fadeIn(t, 0.34, 0.6);
  const l2 = fadeIn(t, 0.48, 0.6);
  const l3 = fadeIn(t, 0.62, 0.6);
  const chipP = [fadeIn(t, 1.15, 0.6), fadeIn(t, 1.4, 0.6), fadeIn(t, 1.65, 0.6)];

  if (L.wide) {
    return `<g opacity="${n(out)}">
      <g opacity="${n(eye)}">
        ${txt(140, 342, 26, 700, C.mint, 'SORUN', { ls: 9 })}
        <rect x="140" y="366" width="90" height="4" rx="2" fill="${C.mint}" opacity="0.55"/>
      </g>
      <g opacity="${n(l1)}" transform="translate(0 ${n((1 - l1) * 24)})">
        ${txt(140, 470, 84, 700, C.txt, 'Hakkın var.', { ls: -1.6 })}
      </g>
      <g opacity="${n(l2)}" transform="translate(0 ${n((1 - l2) * 24)})">
        ${txt(140, 566, 84, 700, C.txt, 'Ama nereden', { ls: -1.6 })}
      </g>
      <g opacity="${n(l3)}" transform="translate(0 ${n((1 - l3) * 24)})">
        ${txt(140, 662, 84, 700, C.mint, 'başlayacaksın?', { ls: -1.6 })}
      </g>
      ${QUESTIONS.map((_, i) => questionChip(1000, 380 + i * 136, 780, 116, i, chipP[i], L)).join('')}
    </g>`;
  }

  return `<g opacity="${n(out)}">
    <g opacity="${n(eye)}">
      ${txt(540, 612, 27, 700, C.mint, 'SORUN', { anchor: 'middle', ls: 9 })}
      <rect x="495" y="636" width="90" height="4" rx="2" fill="${C.mint}" opacity="0.55"/>
    </g>
    <g opacity="${n(l1)}" transform="translate(0 ${n((1 - l1) * 26)})">
      ${txt(540, 744, 92, 700, C.txt, 'Hakkın var.', { anchor: 'middle', ls: -2 })}
    </g>
    <g opacity="${n(l2)}" transform="translate(0 ${n((1 - l2) * 26)})">
      ${txt(540, 850, 92, 700, C.txt, 'Ama nereden', { anchor: 'middle', ls: -2 })}
    </g>
    <g opacity="${n(l3)}" transform="translate(0 ${n((1 - l3) * 26)})">
      ${txt(540, 956, 92, 700, C.mint, 'başlayacaksın?', { anchor: 'middle', ls: -2 })}
    </g>
    ${QUESTIONS.map((_, i) => questionChip(110, 1092 + i * 142, 860, 118, i, chipP[i], L)).join('')}
  </g>`;
}

/* ------------------------------------------------------------------ */
/* Sahne 3 — ürün demosu                                                */
/* ------------------------------------------------------------------ */
function bullet(x, y, label, p, L) {
  const size = L.wide ? 30 : 28;
  return `<g opacity="${n(p)}" transform="translate(${n((1 - p) * -26)} 0)">
    <circle cx="${x}" cy="${y - size * 0.32}" r="17" fill="rgba(96,228,182,0.14)" stroke="${C.mint}" stroke-width="1.6"/>
    <path d="M${x - 6} ${y - size * 0.32} l4.5 5 l7.5 -9" fill="none" stroke="${C.mint}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    ${txt(x + 32, y, size, 500, '#dbe7f2', label)}
  </g>`;
}

function sceneDemo(t, L) {
  const out = fadeOut(t, 5.95, 0.4);
  const headP = fadeIn(t, 0.1, 0.65);
  const phoneP = fadeIn(t, 0.2, 0.8);
  const phoneScale = 0.94 + 0.06 * easeOut(prog(t, 0.2, 1.0));

  if (L.wide) {
    return `<g opacity="${n(out)}">
      <g opacity="${n(headP)}">
        ${txt(820, 322, 24, 700, C.mint, 'ÇÖZÜM', { ls: 9 })}
        <rect x="820" y="346" width="90" height="4" rx="2" fill="${C.mint}" opacity="0.55"/>
        ${txt(820, 452, 80, 700, C.txt, 'Sorununu anlat,', { ls: -1.6 })}
        ${txt(820, 542, 80, 700, C.mint, 'gerisini gör.', { ls: -1.6 })}
      </g>
      ${bullet(838, 660, 'Kategori + resmî başvuru rotası', fadeIn(t, 0.7, 0.6), L)}
      ${bullet(838, 736, 'Kanıt listesi + SHA-256 özeti', fadeIn(t, 0.9, 0.6), L)}
      ${bullet(838, 812, 'İlk talep taslağı hazır', fadeIn(t, 1.1, 0.6), L)}
      <g opacity="${n(fadeIn(t, 1.4, 0.7))}">
        ${txt(820, 926, 24, 400, C.dim, 'Tek ekranda, saniyeler içinde.')}
      </g>
      <g opacity="${n(phoneP)}" transform="translate(140 62) scale(${n(0.845 * phoneScale)})">
        ${phoneScreen(t)}
      </g>
    </g>`;
  }

  return `<g opacity="${n(out)}">
    <g opacity="${n(headP)}" transform="translate(0 ${n((1 - headP) * 26)})">
      ${txt(540, 314, 76, 700, C.txt, 'Sorununu anlat,', { anchor: 'middle', ls: -2 })}
      ${txt(540, 400, 76, 700, C.mint, 'gerisini gör.', { anchor: 'middle', ls: -2 })}
    </g>
    <g opacity="${n(phoneP)}" transform="translate(190 448) scale(${n(phoneScale)})">
      ${phoneScreen(t)}
    </g>
    <g opacity="${n(fadeIn(t, 3.6, 0.7))}">
      ${txt(540, 1692, 27, 500, C.mut, 'Kategori · rota · kanıt · taslak', { anchor: 'middle' })}
      ${txt(540, 1734, 22, 400, C.dim, 'tek ekranda, saniyeler içinde', { anchor: 'middle' })}
    </g>
  </g>`;
}

/* ------------------------------------------------------------------ */
/* Sahne 4 — özellikler                                                 */
/* ------------------------------------------------------------------ */
const FEATURES = [
  { icon: 'lock', title: 'AES-GCM kasa', sub: 'Parola ile cihazda şifreli' },
  { icon: 'key', title: 'PBKDF2 · 250k tur', sub: 'Anahtar cihazda türetilir' },
  { icon: 'hash', title: 'SHA-256', sub: 'Kanıtın parmak izi' },
  { icon: 'save', title: 'JSON yedek', sub: 'Dışa ve içe aktarma' },
  { icon: 'bell', title: 'Hatırlatma', sub: 'Zamanı kaçırma' },
  { icon: 'phone', title: 'PWA / offline', sub: 'Kurulumsuz çalışır' },
];

function featureIcon(name) {
  const s = `fill="none" stroke="${C.mint}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"`;
  switch (name) {
    case 'lock':
      return `<rect x="-12" y="-2" width="24" height="17" rx="4.5" ${s}/><path d="M-6.5 -2 v-5 a6.5 6.5 0 0 1 13 0 v5" ${s}/>`;
    case 'key':
      return `<circle cx="-6" cy="-5" r="6.5" ${s}/><path d="M-1.5 0 L10 11.5 M6.5 8 L11 3.5 M10 11.5 L13 14.5" ${s}/>`;
    case 'hash':
      return `<path d="M-6 -13 L-9.5 12 M6.5 -13 L3 12 M-13 -5.5 H11.5 M-14 4.5 H10.5" ${s}/>`;
    case 'save':
      return `<path d="M0 -13 V7 M-8 -1 L0 7 L8 -1 M-12 13 H12" ${s}/>`;
    case 'bell':
      return `<path d="M-10.5 6.5 H10.5 C8.5 2.5 8.5 -2 8.5 -5 A8.5 8.5 0 0 0 -8.5 -5 C-8.5 -2 -8.5 2.5 -10.5 6.5 Z" ${s}/><path d="M-3 10.5 a3 3 0 0 0 6 0" ${s}/>`;
    default:
      return `<rect x="-8" y="-13" width="16" height="26" rx="4" ${s}/><path d="M-3 9 H3" ${s}/>`;
  }
}

function featureTile(x, y, w, h, f, p, L) {
  const pad = L.wide ? 34 : 34;
  const iconCy = y + (L.wide ? 62 : 70);
  const titleY = y + (L.wide ? 152 : 166);
  const subY = y + (L.wide ? 188 : 202);
  return `<g opacity="${n(p)}" transform="translate(0 ${n((1 - p) * 26)})">
    ${panel(x, y, w, h, 24, 'rgba(13,27,44,0.92)', C.line, 2)}
    <circle cx="${n(x + pad + 30)}" cy="${n(iconCy)}" r="${L.wide ? 32 : 34}" fill="rgba(96,228,182,0.10)" stroke="rgba(96,228,182,0.35)" stroke-width="1.6"/>
    <g transform="translate(${n(x + pad + 30)} ${n(iconCy)}) scale(${L.wide ? 0.92 : 1})">${featureIcon(f.icon)}</g>
    ${txt(x + pad, titleY, L.wide ? 29 : 30, 700, C.txt, f.title)}
    ${txt(x + pad, subY, L.wide ? 20 : 22, 400, C.mut, f.sub)}
  </g>`;
}

function sceneFeatures(t, L) {
  const out = fadeOut(t, 4.15, 0.4);
  const eye = fadeIn(t, 0.15, 0.6);
  const h1 = fadeIn(t, 0.28, 0.6);
  const h2 = fadeIn(t, 0.42, 0.6);
  const tileP = FEATURES.map((_, i) => fadeIn(t, 0.75 + i * 0.13, 0.55));

  if (L.wide) {
    const xs = [140, 686, 1232];
    const ys = [500, 756];
    return `<g opacity="${n(out)}">
      <g opacity="${n(eye)}">
        ${txt(140, 250, 24, 700, C.mint, 'ÇÖZÜM', { ls: 9 })}
        <rect x="140" y="274" width="90" height="4" rx="2" fill="${C.mint}" opacity="0.55"/>
      </g>
      <g opacity="${n(h1)}">${txt(140, 372, 66, 700, C.txt, 'Cihazında kalır,', { ls: -1.4 })}</g>
      <g opacity="${n(h2)}">${txt(140, 448, 66, 700, C.mint, 'kontrol sende.', { ls: -1.4 })}</g>
      ${FEATURES.map((f, i) => featureTile(xs[i % 3], ys[Math.floor(i / 3)], 520, 228, f, tileP[i], L)).join('')}
    </g>`;
  }

  return `<g opacity="${n(out)}">
    <g opacity="${n(eye)}">
      ${txt(540, 392, 26, 700, C.mint, 'ÇÖZÜM', { anchor: 'middle', ls: 9 })}
      <rect x="495" y="416" width="90" height="4" rx="2" fill="${C.mint}" opacity="0.55"/>
    </g>
    <g opacity="${n(h1)}" transform="translate(0 ${n((1 - h1) * 22)})">
      ${txt(540, 516, 74, 700, C.txt, 'Cihazında kalır,', { anchor: 'middle', ls: -2 })}
    </g>
    <g opacity="${n(h2)}" transform="translate(0 ${n((1 - h2) * 22)})">
      ${txt(540, 602, 74, 700, C.mint, 'kontrol sende.', { anchor: 'middle', ls: -2 })}
    </g>
    ${FEATURES.map((f, i) =>
      featureTile(74 + (i % 2) * 472, 700 + Math.floor(i / 2) * 278, 440, 250, f, tileP[i], L)
    ).join('')}
  </g>`;
}

/* ------------------------------------------------------------------ */
/* Sahne 5 — kapanış / çağrı                                            */
/* ------------------------------------------------------------------ */
function tagChip(x, y, w, h, label) {
  return `<g>
    ${panel(x, y, w, h, h / 2, 'rgba(13,27,44,0.8)', C.line, 1.8)}
    <circle cx="${n(x + 26)}" cy="${n(y + h / 2)}" r="5" fill="${C.mint}"/>
    ${txt(x + 42, y + h / 2 + 8, 22, 500, '#dbe7f2', label)}
  </g>`;
}

function ctaTags(x0, y) {
  return ['Kategori', 'Resmî rota', 'Kanıt', 'Taslak']
    .map((label, i) => tagChip(x0 + i * 220, y, 204, 64, label))
    .join('');
}

function sceneCta(t, L) {
  const logo = fadeIn(t, 0.1, 0.7);
  const h1 = fadeIn(t, 0.3, 0.65);
  const h2 = fadeIn(t, 0.48, 0.65);
  const pill = fadeIn(t, 0.8, 0.7);
  const micro = fadeIn(t, 1.15, 0.7);
  const note = fadeIn(t, 1.6, 0.8);
  const breathe = 1 + Math.sin(Math.max(0, t - 0.8) * 3.2) * 0.008;

  if (L.wide) {
    return `<g>
      <g opacity="${n(logo)}">${logoMark(960, 236, 120, { scale: 0.9 + 0.1 * logo })}</g>
      <g opacity="${n(h1)}" transform="translate(0 ${n((1 - h1) * 22)})">
        ${txt(960, 430, 74, 700, C.txt, 'Sen uğraşma,', { anchor: 'middle', ls: -2 })}
      </g>
      <g opacity="${n(h2)}" transform="translate(0 ${n((1 - h2) * 22)})">
        ${txt(960, 516, 74, 700, C.mint, 'hakkını o takip etsin.', { anchor: 'middle', ls: -2 })}
      </g>
      <g opacity="${n(pill)}" transform="${zoomAt(960, 640, breathe)}">
        ${panel(560, 588, 800, 104, 52, C.mint, null)}
        ${txt(960, 653, 34, 700, C.mintInk, 'hakkim-ai-pilot.vercel.app', { anchor: 'middle' })}
      </g>
      <g opacity="${n(micro)}">
        ${txt(960, 744, 25, 400, C.mut, 'Ücretsiz açık beta · kurulum yok · local-first', { anchor: 'middle' })}
      </g>
      <g opacity="${n(fadeIn(t, 1.3, 0.7))}">
        ${ctaTags(528, 796)}
      </g>
      <g opacity="${n(note)}">
        ${txt(960, 952, 20, 400, C.dim, 'Hakkım AI hukuki temsil veya avukatlık hizmeti sunmaz.', { anchor: 'middle' })}
      </g>
    </g>`;
  }

  return `<g>
    <g opacity="${n(logo)}">${logoMark(540, 520, 132, { scale: 0.9 + 0.1 * logo })}</g>
    <g opacity="${n(h1)}" transform="translate(0 ${n((1 - h1) * 24)})">
      ${txt(540, 756, 82, 700, C.txt, 'Sen uğraşma,', { anchor: 'middle', ls: -2 })}
    </g>
    <g opacity="${n(h2)}" transform="translate(0 ${n((1 - h2) * 24)})">
      ${txt(540, 852, 82, 700, C.mint, 'hakkını o takip etsin.', { anchor: 'middle', ls: -2 })}
    </g>
    <g opacity="${n(pill)}" transform="${zoomAt(540, 1000, breathe)}">
      ${panel(130, 946, 820, 108, 54, C.mint, null)}
      ${txt(540, 1014, 36, 700, C.mintInk, 'hakkim-ai-pilot.vercel.app', { anchor: 'middle' })}
    </g>
    <g opacity="${n(micro)}">
      ${txt(540, 1120, 27, 400, C.mut, 'Ücretsiz açık beta · kurulum yok', { anchor: 'middle' })}
      ${txt(540, 1162, 24, 400, C.dim, 'local-first · veriler cihazında', { anchor: 'middle' })}
    </g>
    <g opacity="${n(fadeIn(t, 1.35, 0.7))}">
      ${ctaTags(108, 1252)}
    </g>
    <g opacity="${n(note)}">
      ${txt(540, 1706, 21, 400, C.dim, 'Hakkım AI hukuki temsil veya avukatlık', { anchor: 'middle' })}
      ${txt(540, 1744, 21, 400, C.dim, 'hizmeti sunmaz. Resmî başvurular kullanıcıya aittir.', { anchor: 'middle' })}
    </g>
  </g>`;
}

/* ------------------------------------------------------------------ */
/* Zaman çizelgesi                                                     */
/* ------------------------------------------------------------------ */
const SCENES = [
  { name: 'intro', start: 0.0, end: 3.3, render: sceneIntro },
  { name: 'problem', start: 3.3, end: 8.1, render: sceneProblem },
  { name: 'demo', start: 8.1, end: 14.3, render: sceneDemo },
  { name: 'features', start: 14.3, end: 18.7, render: sceneFeatures },
  { name: 'cta', start: 18.7, end: DURATION, render: sceneCta },
];

const LAYOUT =
  FORMAT === 'wide'
    ? { W: 1920, H: 1080, wide: true }
    : { W: 1080, H: 1920, wide: false };

/* ------------------------------------------------------------------ */
/* Ses yatağı (48 kHz stereo WAV, cihazda sentezlenir)                  */
/* ------------------------------------------------------------------ */
const AUDIO_EVENTS = [0.12, 3.3, 8.1, 14.3, 18.7];
const TAU = Math.PI * 2;

function writeAudioBed(file) {
  const sr = 48000;
  const count = Math.floor(DURATION * sr);
  const pcm = Buffer.alloc(count * 4);
  for (let i = 0; i < count; i++) {
    const t = i / sr;
    const fadeInEnv = Math.min(1, t / 1.5);
    const fadeOutEnv = Math.min(1, Math.max(0, (DURATION - t) / 2.0));
    const swell = 0.74 + 0.26 * Math.sin(TAU * 0.07 * t);
    let v =
      0.055 * Math.sin(TAU * 110 * t) +
      0.030 * Math.sin(TAU * 164.81 * t + 0.5) +
      0.020 * Math.sin(TAU * 220 * t + 1.2) +
      0.012 * Math.sin(TAU * 329.63 * t + 2.1) +
      0.007 * Math.sin(TAU * 440 * t + 0.3);
    v *= swell * fadeInEnv * fadeOutEnv;
    for (const e of AUDIO_EVENTS) {
      const d = t - e;
      if (d > 0) v += 0.17 * Math.sin(TAU * 57 * d) * Math.exp(-7.5 * d) * Math.min(1, d / 0.02);
    }
    v = Math.max(-0.98, Math.min(0.98, v * 1.45));
    const left = Math.round(v * 32767);
    const right = Math.round(v * 0.97 * 32767);
    pcm.writeInt16LE(left, i * 4);
    pcm.writeInt16LE(right, i * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(sr, 24);
  header.writeUInt32LE(sr * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, pcm]));
  return file;
}

/* ------------------------------------------------------------------ */
/* Kare üretimi                                                        */
/* ------------------------------------------------------------------ */
function frameSvg(t) {
  const scene = SCENES.find((s) => t >= s.start && t < s.end) || SCENES[SCENES.length - 1];
  const local = t - scene.start;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${LAYOUT.W}" height="${LAYOUT.H}" viewBox="0 0 ${LAYOUT.W} ${LAYOUT.H}">
    ${background(t, LAYOUT)}
    ${scene.render(local, LAYOUT)}
    ${progressBar(t, LAYOUT)}
  </svg>`;
}

function renderFrame(t) {
  return sharp(Buffer.from(frameSvg(t))).png({ compressionLevel: 1 }).toBuffer();
}

/* ------------------------------------------------------------------ */
/* ffmpeg hattı                                                        */
/* ------------------------------------------------------------------ */
const once = (emitter, event) => new Promise((resolve) => emitter.once(event, resolve));

function ffmpegArgs(audioFile) {
  const a = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-'];
  if (audioFile) a.push('-i', audioFile);
  a.push('-map', '0:v');
  if (audioFile) {
    a.push('-map', '1:a', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2');
  }
  a.push(
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', CRF,
    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.2',
    '-threads', '4', '-r', String(FPS), '-movflags', '+faststart'
  );
  if (audioFile) a.push('-shortest');
  a.push(OUT);
  return a;
}

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  sharp.concurrency(4);
  sharp.cache(false);

  if (BENCH) {
    const cases = [
      ['açılış karesi', frameSvg(2.2)],
      ['sorun karesi', frameSvg(5.5)],
      ['demo karesi', frameSvg(12.5)],
      ['özellik karesi', frameSvg(16.8)],
      ['kapanış karesi', frameSvg(21.0)],
    ];
    for (const [label, svg] of cases) {
      const t0 = Date.now();
      const buf = await sharp(Buffer.from(svg)).png({ compressionLevel: 1 }).toBuffer();
      const meta = await sharp(buf).metadata();
      console.log(`${label}: ${Date.now() - t0} ms · ${meta.width}x${meta.height} · ${(buf.length / 1024).toFixed(0)} KB`);
    }
    return;
  }

  if (STILL !== null) {
    const buf = await renderFrame(STILL);
    fs.writeFileSync(OUT, buf);
    console.log(`Kare yazıldı: ${OUT} (t=${STILL}s)`);
    return;
  }

  const audioFile = SILENT ? null : writeAudioBed(path.join(require('os').tmpdir(), 'hakkim-ai-bed.wav'));
  console.log(
    `Hakkım AI tanıtım videosu → ${path.relative(process.cwd(), OUT)} · ` +
      `${LAYOUT.W}x${LAYOUT.H} · ${FPS} fps · ${DURATION}s${audioFile ? ' · sesli' : ' · sessiz'}`
  );

  const proc = spawn(FFMPEG, ffmpegArgs(audioFile), { stdio: ['pipe', 'inherit', 'inherit'] });
  proc.stdin.on('error', () => {});

  const started = Date.now();
  let lastLog = 0;
  for (let i = 0; i < TOTAL; i++) {
    const t = i / FPS;
    const buf = await renderFrame(t);
    if (!proc.stdin.write(buf)) await once(proc.stdin, 'drain');
    if (i - lastLog >= FPS * 2) {
      lastLog = i;
      const pct = Math.round((i / TOTAL) * 100);
      console.log(`  ${pct}% · ${t.toFixed(1)}s / ${DURATION}s · ${((Date.now() - started) / 1000).toFixed(1)}s`);
    }
  }
  proc.stdin.end();
  const code = await new Promise((resolve) => proc.on('close', resolve));
  if (code !== 0) throw new Error(`ffmpeg ${code} koduyla çıktı`);
  console.log('  100% · kodlama tamamlandı');

  if (POSTER) {
    const posterTime = Number(opt('poster-time', 10.4));
    const frame = await renderFrame(posterTime);
    await sharp(frame).jpeg({ quality: 90, mozjpeg: true }).toFile(path.resolve(POSTER));
    console.log(`Kapak görseli: ${POSTER} (t=${posterTime}s)`);
  }

  const mb = (fs.statSync(OUT).size / (1024 * 1024)).toFixed(2);
  console.log(`Bitti: ${OUT} · ${mb} MB · ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error('Hata:', err.message);
  process.exit(1);
});
