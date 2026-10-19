'use strict';

/* ==========================================================================
   DAFTAR ISI
   1.  Konfigurasi (nama, teks pembuka, urutan halaman)
   2.  Helper kecil
   3.  Efek suara (SFX) — nada sintetis + 3 sampel suara kertas (Base64 MP3, di akhir file)
   4.  Navigasi halaman + indikator titik
   5.  Musik latar (status "ingin menyala" + jeda otomatis saat video)
   6.  Layar penuh (Fullscreen API + fallback immersive CSS)
   7.  Kotak hadiah (animasi pembukaan)
   8.  Buku kenangan (balik halaman 3D)
   9.  Surat (amplop)
   10. Galeri + lightbox
   11. Pemutar video kustom + sinkronisasi musik
   12. Canvas latar: bintang/aurora, kelopak bunga, jejak kursor
   13. Teks pembuka (typer) + inisialisasi
   14. Data sampel suara kertas (Base64 MP3)
   ========================================================================== */


/* ==========================================================================
   1. KONFIGURASI
   ========================================================================== */
const PARTNER_NAME = 'Sayang'; // <-- ganti dengan nama pasangan kamu
const INTRO_LINES = [
  `untukmu, ${PARTNER_NAME}...`,
  'yang membuat hari-hari biasa terasa istimewa...'
];
const PAGE_ORDER = ['page-gift', 'page-book', 'page-letter', 'page-gallery', 'page-video', 'page-final'];
const MUSIC_VOLUME = 0.6;            // volume musik latar (0 - 1)
const GIFT_TO_BOOK_DELAY = 5400;     // ms dari ketukan kotak hadiah sampai pindah ke buku
const BURST_COLORS = ['#f5b8c8', '#e8849a', '#c2607a', '#fce0e8', '#ecd2b6']; // warna bunga SVG saat hadiah dibuka


/* ==========================================================================
   2. HELPER
   ========================================================================== */
const byId = (id) => document.getElementById(id);

/** Daftar fungsi yang dipanggil setiap ukuran layar berubah (resize, rotasi, fullscreen). */
const resizeHandlers = [];
(function watchViewport() {
  let frame = 0;
  const run = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => resizeHandlers.forEach((fn) => fn()));
  };
  window.addEventListener('resize', run);
  window.addEventListener('orientationchange', run);
  ['fullscreenchange', 'webkitfullscreenchange'].forEach((evt) => document.addEventListener(evt, run));
})();

/** Menyamakan ukuran bitmap canvas dengan ukuran layar. */
function fitCanvasToViewport(canvas) {
  if (canvas.width !== window.innerWidth) canvas.width = window.innerWidth;
  if (canvas.height !== window.innerHeight) canvas.height = window.innerHeight;
}


/* ==========================================================================
   3. EFEK SUARA (SFX)
   ========================================================================== */
const SFX = (function () {
  let ctx = null;
  const paperBuffers = [null, null, null];
  let paperLoadStarted = false;

  function getCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, duration, opts = {}) {
    const c = getCtx();
    if (!c) return;
    const t0 = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.glideTo) osc.frequency.exponentialRampToValueAtTime(opts.glideTo, t0 + duration);
    const peak = opts.volume ?? 0.12;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + (opts.attack || 0.012));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  function noiseBurst(duration, opts = {}) {
    const c = getCtx();
    if (!c) return;
    const t0 = c.currentTime;
    const bufferSize = Math.max(1, Math.floor(c.sampleRate * duration));
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    const shape = opts.shape || 'fadeOut';
    for (let i = 0; i < bufferSize; i++) {
      const p = i / bufferSize;
      let env;
      if (shape === 'humpMid') env = Math.sin(p * Math.PI);
      else if (shape === 'flat') env = 1;
      else env = Math.pow(1 - p, 1.6);
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = opts.filterType || 'highpass';
    filter.frequency.setValueAtTime(opts.filterFreq ?? 1200, t0);
    if (opts.filterFreqTo) filter.frequency.linearRampToValueAtTime(opts.filterFreqTo, t0 + duration);
    if (opts.q) filter.Q.value = opts.q;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(opts.volume ?? 0.06, t0 + (opts.attack || 0.008));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(c.destination);
    src.start(t0);
  }

  // Sampel suara kertas: MP3 pendek (Base64) yang di-decode sekali lewat Web Audio.
  function loadPaperBuffers() {
    if (paperLoadStarted) return;
    paperLoadStarted = true;
    const c = getCtx();
    if (!c) return;
    PAPER_SAMPLES_B64.forEach((b64, idx) => {
      try {
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        c.decodeAudioData(bytes.buffer, (decoded) => { paperBuffers[idx] = decoded; }, () => { /* gagal decode: pakai suara sintetis */ });
      } catch (e) { /* gagal decode: pakai suara sintetis */ }
    });
  }

  function playPaperSample() {
    const c = getCtx();
    if (!c) return false;
    const available = paperBuffers.filter(Boolean);
    if (available.length === 0) return false;
    const src = c.createBufferSource();
    src.buffer = available[Math.floor(Math.random() * available.length)];
    const gain = c.createGain();
    gain.gain.value = 0.9;
    src.connect(gain);
    gain.connect(c.destination);
    src.start(0);
    return true;
  }

  return {
    giftOpen() {
      tone(523.25, 0.5, { type: 'sine', volume: 0.1, glideTo: 880 });
      setTimeout(() => tone(659.25, 0.45, { type: 'sine', volume: 0.08 }), 90);
      setTimeout(() => tone(987.77, 0.5, { type: 'sine', volume: 0.06 }), 180);
    },
    // Suara balik halaman: sampel kertas asli; kalau belum siap, pakai versi sintetis berlapis.
    pageFlip() {
      loadPaperBuffers();
      if (playPaperSample()) return;
      noiseBurst(0.07, { shape: 'humpMid', filterType: 'highpass', filterFreq: 2200, filterFreqTo: 3200, volume: 0.045, attack: 0.004 });
      setTimeout(() => noiseBurst(0.26, { shape: 'humpMid', filterType: 'bandpass', filterFreq: 2600, filterFreqTo: 1100, q: 0.7, volume: 0.06, attack: 0.01 }), 35);
      setTimeout(() => noiseBurst(0.18, { shape: 'fadeOut', filterType: 'highpass', filterFreq: 1800, filterFreqTo: 900, volume: 0.035 }), 90);
      setTimeout(() => {
        noiseBurst(0.09, { shape: 'fadeOut', filterType: 'lowpass', filterFreq: 500, volume: 0.05, attack: 0.002 });
        tone(180, 0.07, { type: 'triangle', volume: 0.02, attack: 0.002 });
      }, 230);
    },
    letterOpen() {
      tone(587.33, 0.35, { type: 'sine', volume: 0.08 });
      setTimeout(() => tone(880, 0.4, { type: 'sine', volume: 0.07 }), 140);
    },
    softPop() {
      tone(440, 0.09, { type: 'sine', volume: 0.07, attack: 0.005, glideTo: 660 });
    },
    photoTap() {
      tone(700, 0.06, { type: 'square', volume: 0.025 });
    }
  };
})();


/* ==========================================================================
   4. NAVIGASI HALAMAN
   ========================================================================== */
const pages = document.querySelectorAll('.page');
const dotsWrap = byId('progressDots');

PAGE_ORDER.forEach((id) => {
  const dot = document.createElement('span');
  dot.dataset.id = id;
  dotsWrap.appendChild(dot);
});

function showPage(id) {
  // Video hanya berjalan saat halamannya terlihat; efek ketik surat dituntaskan saat halaman surat ditinggalkan.
  if (id === 'page-video') VideoPlayer.play(); else VideoPlayer.pause();
  Music.hold(id === 'page-video'); // musik latar dijeda selama video bersuara diputar
  if (id !== 'page-letter') LetterTyper.finish();

  pages.forEach((p) => p.classList.toggle('active', p.id === id));
  const idx = PAGE_ORDER.indexOf(id);
  Array.from(dotsWrap.children).forEach((d, i) => {
    d.classList.remove('now', 'done');
    if (i < idx) d.classList.add('done');
    if (i === idx) d.classList.add('now');
  });
  window.scrollTo(0, 0);
}

document.querySelectorAll('[data-next]').forEach((btn) => {
  btn.addEventListener('click', () => {
    SFX.softPop();
    showPage(btn.getAttribute('data-next'));
  });
});


/* ==========================================================================
   5. MUSIK LATAR
   --------------------------------------------------------------------------
   wanted = pengguna ingin musik menyala (diset saat hadiah dibuka / tombol musik)
   Video bagian pesan bersuara, jadi musik dijeda otomatis selama halaman video tampil
   (hold) lalu dilanjutkan bila pengguna memang menginginkannya. Posisi lagu tidak
   pernah direset (hanya pause/play), dan musik yang dimatikan pengguna tidak dinyalakan paksa.
   ========================================================================== */
const Music = (function () {
  const audio = byId('bgMusic');
  const btn = byId('musicBtn');
  const iconOn = btn.querySelector('.icon-on');
  const iconOff = btn.querySelector('.icon-off');
  let wanted = false;
  let held = false;   // true saat halaman video tampil: musik dijeda, tapi pilihan pengguna (wanted) tetap
  let fadeTimer = null;

  function render() {
    iconOn.toggleAttribute('hidden', !wanted);
    iconOff.toggleAttribute('hidden', wanted);
    btn.classList.toggle('muted', !wanted);
    btn.setAttribute('aria-pressed', String(wanted));
  }

  function fadeIn() {
    clearInterval(fadeTimer);
    let v = Math.min(audio.volume, MUSIC_VOLUME);
    fadeTimer = setInterval(() => {
      v += 0.04;
      audio.volume = Math.min(v, MUSIC_VOLUME);
      if (v >= MUSIC_VOLUME) clearInterval(fadeTimer);
    }, 120);
  }

  function startPlayback() {
    audio.volume = 0;
    const p = audio.play();
    if (p && typeof p.then === 'function') {
      p.then(() => {
        // Video sempat dibuka saat musik masih memulai: jangan lanjut fade-in, langsung diamkan lagi.
        if (held || !wanted) { clearInterval(fadeTimer); audio.pause(); return; }
        fadeIn();
      }).catch(() => {
        // Diblokir autoplay / file hilang: jangan pura-pura menyala.
        wanted = false;
        render();
      });
    } else {
      fadeIn();
    }
  }

  function sync() {
    audio.muted = held; // selama video: musik dibisukan sekaligus dijeda
    if (wanted && !held) {
      if (audio.paused) startPlayback();
    } else if (!audio.paused) {
      clearInterval(fadeTimer);
      audio.pause();
    }
    render();
  }

  btn.addEventListener('click', () => {
    wanted = !wanted;
    sync();
  });

  render();

  return {
    turnOn() { wanted = true; sync(); },
    /** Jeda/lanjutkan musik karena video bersuara; tidak mengubah pilihan pengguna. */
    hold(on) { if (held === on) return; held = on; sync(); }
  };
})();


/* ==========================================================================
   6. LAYAR PENUH
   --------------------------------------------------------------------------
   Mengikuti pola repo referensi (spidermine): requestFullscreen() dipanggil
   langsung di dalam handler ketukan (user gesture) pada <html>, dengan prefix
   webkit, promise rejection ditangani, dan fullscreenchange dipantau.
   Jika browser menolak / tidak mendukung (mis. iPhone Safari), situs tetap
   masuk mode "immersive" via CSS (kelas .is-immersive + satuan dvh).
   Itu BUKAN fullscreen sistem — bar browser tetap ada di perangkat tersebut.
   ========================================================================== */
const Fullscreen = (function () {
  const root = document.documentElement;
  const fsBtn = byId('fsBtn');
  const fsIconEnter = fsBtn.querySelector('.icon-enter');
  const fsIconExit = fsBtn.querySelector('.icon-exit');

  const requestFn = root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen;
  const supported = !!requestFn && document.fullscreenEnabled !== false;

  function element() {
    return document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || null;
  }

  function request(el) {
    const target = el || root;
    const fn = target.requestFullscreen || target.webkitRequestFullscreen || target.msRequestFullscreen;
    if (!fn) return Promise.resolve(false);
    try {
      const result = target === root ? fn.call(target, { navigationUI: 'hide' }) : fn.call(target);
      return Promise.resolve(result).then(() => true, () => false);
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  function exit() {
    const fn = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (!fn || !element()) return Promise.resolve();
    try {
      return Promise.resolve(fn.call(document)).catch(() => {});
    } catch (e) {
      return Promise.resolve();
    }
  }

  function render() {
    const on = element() === root;
    root.classList.toggle('is-fullscreen', on);
    fsIconEnter.toggleAttribute('hidden', on);
    fsIconExit.toggleAttribute('hidden', !on);
    fsBtn.title = on ? 'Keluar layar penuh' : 'Layar penuh';
    fsBtn.setAttribute('aria-label', fsBtn.title);
  }

  ['fullscreenchange', 'webkitfullscreenchange', 'msfullscreenchange'].forEach((evt) => {
    document.addEventListener(evt, render);
  });

  fsBtn.hidden = !supported;
  fsBtn.addEventListener('click', () => {
    if (element()) exit();
    else request(root);
  });

  return {
    supported,
    element,
    request,
    exit,
    /** Dipanggil dari ketukan kotak hadiah. */
    enter() {
      root.classList.add('is-immersive'); // fallback CSS selalu aktif
      if (supported && !element()) request(root); // fullscreen sistem bila diizinkan
    }
  };
})();


/* ==========================================================================
   7. KOTAK HADIAH
   ========================================================================== */
let giftOpened = false;

function openGift() {
  if (giftOpened) return;
  giftOpened = true;

  // Harus dipanggil langsung di handler ketukan agar diizinkan browser.
  Fullscreen.enter();

  const gift = byId('giftBox');
  const hintLabel = byId('giftHintLabel');
  const layer = byId('burst-layer');
  const bc = byId('burst-canvas');
  const bx = bc.getContext('2d');

  Music.turnOn();
  SFX.giftOpen();
  hintLabel.textContent = 'thanks for opening this';

  const lid = gift.querySelector('.gift-lid');
  const box = gift.querySelector('.gift-box-body');
  const bow = gift.querySelector('.gift-bow');

  const flyAway = [
    { transform: 'translateX(-50%) translateY(0px) rotate(0deg)', opacity: 1 },
    { transform: 'translateX(-70%) translateY(-55px) rotate(-15deg)', opacity: 1, offset: 0.35 },
    { transform: 'translateX(-80%) translateY(-170px) rotate(-30deg)', opacity: 0, offset: 1 }
  ];
  const flyOpts = { duration: 500, easing: 'cubic-bezier(0.25,0.46,0.45,0.94)', fill: 'forwards' };
  lid.animate(flyAway, flyOpts);
  bow.animate(flyAway, flyOpts);

  setTimeout(() => {
    box.animate([
      { transform: 'translateX(0px) rotate(0deg)' },
      { transform: 'translateX(-5px) rotate(-2deg)', offset: 0.2 },
      { transform: 'translateX(5px) rotate(2deg)', offset: 0.4 },
      { transform: 'translateX(-3px) rotate(-1deg)', offset: 0.6 },
      { transform: 'translateX(3px) rotate(1deg)', offset: 0.8 },
      { transform: 'translateX(0px) rotate(0deg)' }
    ], { duration: 400, easing: 'ease-in-out' });
  }, 80);

  // Posisi asal ledakan dihitung saat ledakan dimulai (layar bisa berubah ukuran
  // karena transisi fullscreen), bukan saat ketukan.
  setTimeout(() => {
    fitCanvasToViewport(bc);
    const rect = gift.getBoundingClientRect();
    const ox = rect.left + rect.width / 2;
    const oy = rect.top + rect.height * 0.2;
    layer.style.display = 'block';
    bc.style.display = 'block';
    spawnFlowers(ox, oy, layer, 0, 45);
    spawnFlowers(ox, oy, layer, 230, 28);
    spawnFlowers(ox, oy, layer, 500, 18);
    spawnDots(ox, oy, bc, bx);
  }, 480);

  setTimeout(() => transitionToBook(layer, bc, bx), GIFT_TO_BOOK_DELAY);
}

byId('giftBox').addEventListener('click', openGift);
resizeHandlers.push(() => {
  const bc = byId('burst-canvas');
  if (bc.style.display === 'block') fitCanvasToViewport(bc);
});

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgNode(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.keys(attrs).forEach((k) => node.setAttribute(k, attrs[k]));
  return node;
}

// Partikel ledakan hadiah: bunga / daisy / hati / kilau sebagai SVG (bukan emoji).
function createBurstIcon(size) {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const color = pick(BURST_COLORS);
  const kind = pick(['blossom', 'blossom', 'blossom', 'daisy', 'heart', 'sparkle']);
  const svg = svgNode('svg', { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true', focusable: 'false' });
  svg.style.display = 'block';
  if (kind === 'blossom') {
    for (let i = 0; i < 5; i++) {
      svg.appendChild(svgNode('ellipse', { cx: 12, cy: 6.6, rx: 3.7, ry: 5.3, fill: color, transform: `rotate(${i * 72} 12 12)` }));
    }
    svg.appendChild(svgNode('circle', { cx: 12, cy: 12, r: 2.4, fill: '#ecd2b6' }));
  } else if (kind === 'daisy') {
    for (let i = 0; i < 8; i++) {
      svg.appendChild(svgNode('ellipse', { cx: 12, cy: 5.6, rx: 1.9, ry: 5, fill: color, transform: `rotate(${i * 45} 12 12)` }));
    }
    svg.appendChild(svgNode('circle', { cx: 12, cy: 12, r: 2.7, fill: '#e3c39a' }));
  } else if (kind === 'heart') {
    svg.appendChild(svgNode('path', { fill: color, d: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z' }));
  } else {
    svg.appendChild(svgNode('path', { fill: color, d: 'M12 2C12.8 7.5 16.5 11.2 22 12 16.5 12.8 12.8 16.5 12 22 11.2 16.5 7.5 12.8 2 12 7.5 11.2 11.2 7.5 12 2z' }));
  }
  return svg;
}

function spawnFlowers(ox, oy, layer, startDelay, count) {
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const el = document.createElement('div');
      const size = Math.random() * 26 + 18;
      el.style.cssText = `position:fixed;left:${ox}px;top:${oy}px;width:${size}px;height:${size}px;line-height:0;pointer-events:none;z-index:620;will-change:transform,opacity;opacity:0;`;
      el.appendChild(createBurstIcon(size));
      layer.appendChild(el);

      let vx = (Math.random() - 0.5) * 580;
      let vy = -(Math.random() * 680 + 380);
      const drag = 0.988;
      const gravity = 155 + Math.random() * 95;
      const swayAmp = (Math.random() - 0.5) * 150;
      const swayFreq = 0.5 + Math.random() * 1.0;
      const rotStart = Math.random() * 360;
      const rotSpeed = (Math.random() - 0.5) * 340;
      const lifetime = 4300 + Math.random() * 1400;
      let px = 0;
      let py = 0;
      let born = null;

      function tick(ts) {
        if (!born) born = ts;
        const elapsed = ts - born;
        const t = elapsed / 1000;
        const progress = elapsed / lifetime;
        if (progress >= 1) { el.remove(); return; }
        const dt = 0.016;
        vx *= drag;
        vy = vy * drag + gravity * dt;
        px += vx * dt;
        py += vy * dt;
        const swayX = Math.sin(t * swayFreq * Math.PI * 2) * swayAmp * Math.min(t * 2, 1);
        const rot = rotStart + rotSpeed * t;
        const sc = Math.min(elapsed / 60, 1);
        const op = elapsed < 60 ? elapsed / 60 : (progress < 0.65 ? 1 : Math.max(0, 1 - (progress - 0.65) / 0.35));
        el.style.transform = `translate(calc(${px + swayX}px - 50%), calc(${py}px - 50%)) rotate(${rot}deg) scale(${sc})`;
        el.style.opacity = op;
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }, startDelay + Math.random() * 170);
  }
}

function spawnDots(ox, oy, bc, bx) {
  const colors = ['#f5b8c8', '#e8849a', '#c2607a', '#ecd2b6', '#ffffff', '#e3c39a'];
  const particles = [];
  for (let i = 0; i < 200; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = Math.random() * 15 + 4;
    const isDot = i < 150;
    particles.push({
      kind: isDot ? 'dot' : 'streak', x: ox, y: oy, px: ox, py: oy,
      vx: Math.cos(a) * spd, vy: Math.sin(a) * spd - (Math.random() * 8 + 2),
      grav: isDot ? 0.22 + Math.random() * 0.13 : 0.13,
      drag: 0.96 + Math.random() * 0.02,
      col: colors[Math.floor(Math.random() * colors.length)],
      r: Math.random() * 4 + 1.4, op: 1,
      decay: isDot ? 0.004 + Math.random() * 0.005 : 0.011 + Math.random() * 0.01,
      trail: []
    });
  }

  function dotTick() {
    bx.clearRect(0, 0, bc.width, bc.height);
    let alive = false;
    for (const p of particles) {
      if (p.op <= 0) continue;
      alive = true;
      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > 6) p.trail.shift();
      p.px = p.x;
      p.py = p.y;
      p.vx *= p.drag;
      p.vy = p.vy * p.drag + p.grav;
      p.x += p.vx;
      p.y += p.vy;
      p.op -= p.decay;
      if (p.kind === 'dot') {
        for (let t = 0; t < p.trail.length; t++) {
          bx.globalAlpha = Math.max(0, p.op * (t / p.trail.length) * 0.3);
          bx.fillStyle = p.col;
          bx.beginPath();
          bx.arc(p.trail[t].x, p.trail[t].y, p.r * (t / p.trail.length), 0, Math.PI * 2);
          bx.fill();
        }
        bx.globalAlpha = Math.max(0, p.op);
        bx.fillStyle = p.col;
        bx.beginPath();
        bx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        bx.fill();
      } else {
        bx.globalAlpha = Math.max(0, p.op * 0.7);
        bx.strokeStyle = p.col;
        bx.lineWidth = 2;
        bx.lineCap = 'round';
        bx.beginPath();
        bx.moveTo(p.px, p.py);
        bx.lineTo(p.x, p.y);
        bx.stroke();
      }
    }
    bx.globalAlpha = 1;
    if (alive) {
      requestAnimationFrame(dotTick);
    } else {
      bc.style.display = 'none';
      bx.clearRect(0, 0, bc.width, bc.height);
    }
  }
  requestAnimationFrame(dotTick);
}

function transitionToBook(layer, bc, bx) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:800;pointer-events:none;opacity:0;background:#100a10;transition:opacity 1.3s cubic-bezier(0.4,0,0.2,1);';
  document.body.appendChild(overlay);
  requestAnimationFrame(() => requestAnimationFrame(() => { overlay.style.opacity = '1'; }));
  setTimeout(() => {
    showPage('page-book');
    layer.style.display = 'none';
    layer.innerHTML = '';
    bc.style.display = 'none';
    bx.clearRect(0, 0, bc.width, bc.height);
    overlay.style.transition = 'opacity 1s ease';
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 1100);
  }, 1400);
}


/* ==========================================================================
   8. BUKU KENANGAN — logika balik halaman
   ========================================================================== */
// Urut naik: index 0 = daun "1" (paling atas, dibalik pertama) ... index 4 = daun "5".
const leaves = Array.from(document.querySelectorAll('.leaf')).sort(
  (a, b) => parseInt(a.dataset.leaf, 10) - parseInt(b.dataset.leaf, 10)
);
const bookProgress = byId('bookProgress');
const bookNextBtn = byId('bookNextBtn');
let flippedCount = 0;
let flipOrderCounter = 1;

// z-index dinamis: daun berikutnya yang akan dibalik ada di atas (sisi kanan),
// daun yang terakhir dibalik ada di atas (sisi kiri) agar ketukan "kembali" tepat sasaran.
function updateLeafZIndex() {
  leaves.filter((l) => !l.classList.contains('flipped')).forEach((leaf, i) => { leaf.style.zIndex = 50 - i; });
  leaves.filter((l) => l.classList.contains('flipped')).forEach((leaf, i) => { leaf.style.zIndex = 20 + i; });
}
updateLeafZIndex();

function renderBookProgress() {
  bookProgress.innerHTML = `page <strong>${flippedCount * 2}</strong> of <strong>10</strong> opened`;
}

function flipLeaf(leaf) {
  if (leaf.classList.contains('flipped')) return;
  const unflipped = leaves.filter((l) => !l.classList.contains('flipped'));
  if (unflipped[0] !== leaf) return; // hanya daun teratas yang boleh dibalik

  SFX.pageFlip();
  leaf.classList.add('flipped');
  leaf.dataset.flipOrder = String(flipOrderCounter++);
  flippedCount++;
  renderBookProgress();
  bookNextBtn.classList.add('hidden');
  updateLeafZIndex();

  if (flippedCount === leaves.length) {
    setTimeout(() => bookNextBtn.classList.remove('hidden'), 600);
  }
}

function unflipLeaf(leaf) {
  if (!leaf.classList.contains('flipped')) return;
  const flipped = leaves
    .filter((l) => l.classList.contains('flipped'))
    .sort((a, b) => parseInt(a.dataset.flipOrder || 0, 10) - parseInt(b.dataset.flipOrder || 0, 10));
  if (flipped[flipped.length - 1] !== leaf) return; // hanya daun yang terakhir dibalik

  SFX.pageFlip();
  leaf.classList.remove('flipped');
  delete leaf.dataset.flipOrder;
  flippedCount--;
  renderBookProgress();
  bookNextBtn.classList.add('hidden');
  updateLeafZIndex();
}

leaves.forEach((leaf) => {
  leaf.addEventListener('click', () => {
    if (leaf.classList.contains('flipped')) unflipLeaf(leaf);
    else flipLeaf(leaf);
  });
});


/* ==========================================================================
   9. SURAT (AMPLOP)
   ========================================================================== */
const envelope = byId('envelope');
const letterPaper = byId('letterPaper');
const letterHint = byId('letterHint');
const letterNextBtn = byId('letterNextBtn');

/* Efek ketik: teks asli dipecah per huruf ke dalam <span> lewat textContent (bukan innerHTML),
   semuanya tetap ada di DOM sehingga tinggi kertas tidak berubah saat mengetik. Huruf hanya
   dimunculkan (fade) sesuai jadwal dalam SATU loop requestAnimationFrame, tanpa timer lain. */
const LetterTyper = (function () {
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const BASE_DELAY = 17;       // ms per huruf (rata-rata)
  const START_DELAY = 800;     // ms setelah amplop diketuk, saat kertas mulai terangkat
  const PAUSE_SOFT = 90;       // jeda setelah koma
  const PAUSE_HARD = 200;      // jeda setelah titik / tanda hubung panjang
  const PAUSE_PARAGRAPH = 350; // jeda antarparagraf

  const items = [];            // { el, at }
  let started = false;
  let finished = false;
  let raf = 0;
  let idx = 0;
  let elapsed = -START_DELAY;
  let last = 0;

  function delayFor(ch, i) {
    const jitter = 0.75 + ((i * 7919) % 100) / 100 * 0.6; // 0.75–1.35, deterministik
    let d = BASE_DELAY * jitter;
    if (ch === ',' || ch === ';' || ch === ':') d += PAUSE_SOFT;
    else if (ch === '.' || ch === '!' || ch === '?' || ch === '—') d += PAUSE_HARD;
    return d;
  }

  function prepare() {
    if (reduceMotion) return; // gerak dikurangi: teks langsung tampil utuh
    let t = 0;
    let n = 0;
    letterPaper.querySelectorAll('.letter-text, .letter-signoff').forEach((p) => {
      const text = p.textContent.replace(/\s+/g, ' ').trim(); // sama dengan hasil render aslinya
      const frag = document.createDocumentFragment();
      Array.from(text).forEach((ch) => {
        const span = document.createElement('span');
        span.className = 'tc';
        span.textContent = ch;
        frag.appendChild(span);
        items.push({ el: span, at: t });
        t += delayFor(ch, n++);
      });
      p.textContent = '';
      p.appendChild(frag);
      t += PAUSE_PARAGRAPH;
    });
    letterPaper.classList.add('is-typing-ready');
  }

  function tick(now) {
    if (!last) last = now;
    elapsed += Math.min(now - last, 100); // tab di latar tidak membuat teks "melompat"
    last = now;
    while (idx < items.length && items[idx].at <= elapsed) items[idx++].el.classList.add('on');
    if (idx < items.length) {
      raf = requestAnimationFrame(tick);
    } else {
      raf = 0;
      finished = true;
    }
  }

  function start() {
    if (started) return;
    started = true;
    if (reduceMotion || !items.length) { finished = true; return; }
    raf = requestAnimationFrame(tick);
  }

  // Tampilkan sisa teks seketika (dipakai saat pengguna lanjut ke halaman berikutnya).
  function finish() {
    if (!started || finished) return;
    cancelAnimationFrame(raf);
    raf = 0;
    while (idx < items.length) items[idx++].el.classList.add('on');
    finished = true;
  }

  prepare();
  return { start, finish };
})();

envelope.addEventListener('click', () => {
  if (envelope.classList.contains('opened')) return;
  SFX.letterOpen();
  envelope.classList.add('opened');
  LetterTyper.start();
  letterHint.textContent = '✦ hope this reaches you ♡ ✦';
  setTimeout(() => letterNextBtn.classList.remove('hidden'), 500);
});


/* ==========================================================================
   10. GALERI MOSAIK + LIGHTBOX
   ========================================================================== */
const tileObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry, i) => {
    if (entry.isIntersecting) {
      setTimeout(() => entry.target.classList.add('in-view'), i * 70);
      tileObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.15 });
document.querySelectorAll('.mosaic-tile').forEach((t) => tileObserver.observe(t));

const lightbox = byId('lightbox');
const lbImg = byId('lbImg');
const lbCap = byId('lbCap');

function openLightbox(tile) {
  const img = tile.querySelector('img');
  if (!img) return;
  SFX.photoTap();
  lbImg.src = img.currentSrc || img.src;
  lbImg.alt = tile.dataset.cap || '';
  lbCap.textContent = tile.dataset.cap || '';
  lightbox.classList.add('open');
}
function closeLightbox() { lightbox.classList.remove('open'); }

byId('mosaicWall').addEventListener('click', (e) => {
  const tile = e.target.closest('.mosaic-tile');
  if (tile) openLightbox(tile);
});
byId('lbClose').addEventListener('click', closeLightbox);
lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });


/* ==========================================================================
   11. VIDEO PESAN (AUTOPLAY BERSUARA, TANPA KONTROL)
   --------------------------------------------------------------------------
   Video hanya elemen visual: tanpa tombol, bar, volume, atau fullscreen buatan.
   Diputar dengan suara saat halamannya tampil (dipanggil dari ketukan tombol, jadi
   diizinkan browser), dijeda saat ditinggalkan. Jika browser tetap menolak suara
   (NotAllowedError), video jalan muted dan suaranya dinyalakan pada ketukan pertama
   di halaman itu, tanpa tombol tambahan.
   ========================================================================== */
const VideoPlayer = (function () {
  const video = byId('storyVideo');
  const page = byId('page-video');
  let unlockArmed = false;

  function unmute() {
    video.muted = false;
    video.defaultMuted = false;
    video.volume = 1;
  }

  function armUnlock() {
    if (unlockArmed) return;
    unlockArmed = true;
    const events = ['pointerdown', 'touchend', 'keydown'];
    const unlock = () => {
      events.forEach((e) => document.removeEventListener(e, unlock, true));
      unlockArmed = false;
      if (page.classList.contains('active') && !video.paused) unmute();
    };
    events.forEach((e) => document.addEventListener(e, unlock, true));
  }

  function play() {
    unmute();
    try {
      const p = video.play();
      if (p && typeof p.catch === 'function') {
        p.catch((err) => {
          if (!err || err.name !== 'NotAllowedError') return; // gagal lain (mis. file): biarkan
          video.muted = true;                                  // setidaknya gambar tetap berjalan
          const q = video.play();
          if (q && typeof q.catch === 'function') q.catch(() => {});
          armUnlock();
        });
      }
    } catch (e) { /* abaikan */ }
  }

  // pause() tanpa syarat juga membatalkan autoplay yang tertunda saat halaman video belum tampil.
  function pause() {
    try { video.pause(); } catch (e) { /* abaikan */ }
  }

  return { play, pause };
})();


/* ==========================================================================
   12. CANVAS LATAR
   ========================================================================== */

/* --- Bintang, orb aurora, debu --- */
(function ambientBackground() {
  const canvas = byId('bg-canvas');
  const ctx = canvas.getContext('2d');
  fitCanvasToViewport(canvas);

  // Posisi bintang disimpan sebagai pecahan (0-1) supaya otomatis menyesuaikan ukuran layar.
  const stars = [];
  for (let i = 0; i < 150; i++) {
    stars.push({
      x: Math.random(), y: Math.random(),
      r: Math.random() * 1.2 + 0.2, op: Math.random() * 0.7 + 0.1,
      twinkleSpeed: Math.random() * 0.02 + 0.005, twinkleOffset: Math.random() * Math.PI * 2,
      color: Math.random() < 0.3 ? '#f5b8c8' : Math.random() < 0.5 ? '#e3c39a' : '#ffffff'
    });
  }

  const orbs = [
    { x: 0.25, y: 0.3, r: 0.32, col: 'rgba(194,96,122,', baseOp: 0.07, speed: 0.00018, angle: 0 },
    { x: 0.75, y: 0.6, r: 0.28, col: 'rgba(139,80,55,', baseOp: 0.08, speed: 0.00022, angle: 2.1 },
    { x: 0.5, y: 0.15, r: 0.22, col: 'rgba(201,149,108,', baseOp: 0.06, speed: 0.00014, angle: 4.2 },
    { x: 0.15, y: 0.75, r: 0.2, col: 'rgba(194,96,122,', baseOp: 0.05, speed: 0.0002, angle: 1.0 },
    { x: 0.85, y: 0.2, r: 0.18, col: 'rgba(100,60,40,', baseOp: 0.08, speed: 0.00016, angle: 3.5 }
  ];

  const dust = [];
  for (let i = 0; i < 55; i++) {
    dust.push({
      x: Math.random(), y: Math.random(),
      r: Math.random() * 2 + 0.5, op: Math.random() * 0.18 + 0.04,
      vx: (Math.random() - 0.5) * 0.12, vy: (Math.random() - 0.5) * 0.08,
      col: Math.random() < 0.5 ? 'rgba(194,96,122,' : 'rgba(201,149,108,'
    });
  }

  resizeHandlers.push(() => fitCanvasToViewport(canvas));

  let frame = 0;
  (function animate() {
    frame++;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#100a10';
    ctx.fillRect(0, 0, W, H);

    orbs.forEach((o) => {
      o.angle += o.speed;
      const cx = (o.x + Math.sin(o.angle) * 0.12) * W;
      const cy = (o.y + Math.cos(o.angle * 0.7) * 0.09) * H;
      const pulse = Math.sin(frame * 0.015 + o.angle) * 0.025;
      const rad = (o.r + pulse) * Math.min(W, H);
      const op = o.baseOp + Math.sin(frame * 0.012 + o.angle) * 0.03;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      grad.addColorStop(0, `${o.col}${op})`);
      grad.addColorStop(0.5, `${o.col}${op * 0.4})`);
      grad.addColorStop(1, `${o.col}0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fill();
    });

    dust.forEach((d) => {
      d.x += d.vx / W;
      d.y += d.vy / H;
      if (d.x < -0.01) d.x = 1.01;
      if (d.x > 1.01) d.x = -0.01;
      if (d.y < -0.01) d.y = 1.01;
      if (d.y > 1.01) d.y = -0.01;
      const px = d.x * W;
      const py = d.y * H;
      ctx.globalAlpha = Math.max(0, d.op + Math.sin(frame * 0.02 + px * 0.01) * 0.05);
      ctx.fillStyle = `${d.col}1)`;
      ctx.beginPath();
      ctx.arc(px, py, d.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    stars.forEach((s) => {
      const tw = Math.sin(frame * s.twinkleSpeed + s.twinkleOffset) * 0.5 + 0.5;
      ctx.globalAlpha = s.op * (0.4 + tw * 0.6);
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r * (0.7 + tw * 0.5), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    requestAnimationFrame(animate);
  })();
})();

/* --- Kelopak bunga melayang --- */
(function floatingPetals() {
  const canvas = byId('petal-canvas');
  const ctx = canvas.getContext('2d');
  fitCanvasToViewport(canvas);
  resizeHandlers.push(() => fitCanvasToViewport(canvas));

  const petals = [];
  const colors = ['#c2607a', '#e8849a', '#f5b8c8', '#c9956c', '#e3c39a'];

  function makePetal() {
    return {
      x: Math.random() * canvas.width, y: -20,
      size: Math.random() * 8 + 5, vy: Math.random() * 1 + 0.3, vx: (Math.random() - 0.5) * 0.6,
      rot: Math.random() * 360, rotV: (Math.random() - 0.5) * 1.6,
      op: Math.random() * 0.4 + 0.15, col: colors[Math.floor(Math.random() * colors.length)],
      sw: Math.random() * 1.4, swo: Math.random() * Math.PI * 2
    };
  }
  for (let i = 0; i < 20; i++) {
    const p = makePetal();
    p.y = Math.random() * canvas.height;
    petals.push(p);
  }

  let frame = 0;
  (function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    frame++;
    if (frame % 18 === 0 && petals.length < 36) petals.push(makePetal());
    for (let i = petals.length - 1; i >= 0; i--) {
      const p = petals[i];
      p.y += p.vy;
      p.x += p.vx + Math.sin(frame * 0.018 + p.swo) * p.sw * 0.25;
      p.rot += p.rotV;
      ctx.save();
      ctx.globalAlpha = p.op;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * Math.PI / 180);
      ctx.fillStyle = p.col;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size * 0.45, p.size, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (p.y > canvas.height + 30) petals.splice(i, 1);
    }
    requestAnimationFrame(animate);
  })();
})();

/* --- Jejak hati/kilau mengikuti kursor atau jari --- */
(function cursorTrail() {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const canvas = document.createElement('canvas');
  canvas.id = 'cursor-trail-canvas';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  fitCanvasToViewport(canvas);
  resizeHandlers.push(() => fitCanvasToViewport(canvas));

  const symbols = ['♡', '✦', '✧', '·'];
  const particles = [];
  const SPAWN_INTERVAL = 70; // ms, dibatasi supaya tetap ringan
  let lastSpawn = 0;

  function spawn(x, y) {
    particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 0.4,
      vy: -(Math.random() * 0.5 + 0.3),
      size: Math.random() * 9 + 8,
      rot: Math.random() * 40 - 20,
      op: 0.85,
      decay: 0.018 + Math.random() * 0.012,
      sym: symbols[Math.floor(Math.random() * symbols.length)],
      col: Math.random() < 0.5 ? '#e8849a' : '#ecd2b6'
    });
    if (particles.length > 40) particles.shift();
  }

  function handleMove(x, y) {
    const now = performance.now();
    if (now - lastSpawn > SPAWN_INTERVAL) {
      lastSpawn = now;
      spawn(x + (Math.random() * 10 - 5), y + (Math.random() * 10 - 5));
    }
  }

  window.addEventListener('mousemove', (e) => handleMove(e.clientX, e.clientY), { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (e.touches && e.touches[0]) handleMove(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });

  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.op -= p.decay;
      if (p.op <= 0) { particles.splice(i, 1); continue; }
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.op);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * Math.PI / 180);
      ctx.font = `${p.size}px sans-serif`;
      ctx.fillStyle = p.col;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.sym, 0, 0);
      ctx.restore();
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();


/* ==========================================================================
   13. TEKS PEMBUKA (TYPER) + INISIALISASI
   ========================================================================== */
(function runIntroTyper() {
  const typerEl = byId('introTyper');
  const textEl = byId('introTyperText');
  const giftContent = byId('giftContent');
  if (!typerEl || !textEl || !giftContent) return;

  let lineIndex = 0;

  function typeLine(line, onDone) {
    let i = 0;
    textEl.textContent = '';
    const interval = setInterval(() => {
      textEl.textContent += line.charAt(i);
      i++;
      if (i >= line.length) {
        clearInterval(interval);
        setTimeout(onDone, 750);
      }
    }, 55);
  }

  function nextLine() {
    if (lineIndex >= INTRO_LINES.length) {
      typerEl.classList.add('done');
      setTimeout(() => giftContent.classList.add('visible'), 350);
      return;
    }
    typeLine(INTRO_LINES[lineIndex], () => {
      lineIndex++;
      if (lineIndex < INTRO_LINES.length) {
        textEl.style.transition = 'opacity .3s ease';
        textEl.style.opacity = '0';
        setTimeout(() => {
          textEl.style.opacity = '1';
          nextLine();
        }, 350);
      } else {
        nextLine();
      }
    });
  }

  nextLine();
})();

showPage('page-gift');


/* ==========================================================================
   14. DATA SAMPEL SUARA KERTAS (Base64 MP3, ±4 KB per sampel)
   Ini aset audio asli (bukan enkripsi/obfuscation) yang di-decode oleh SFX.pageFlip().
   ========================================================================== */
const PAPER_SAMPLES_B64 = [
  "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"
];