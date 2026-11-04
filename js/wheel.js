// Колесо на canvas: сектора рендерятся один раз во внеэкранный холст, на каждом кадре он только поворачивается.

export const PALETTES = {
  neon:    { name: 'Неон',     colors: ['#ff4d9d', '#7c5cff', '#00c2ff', '#ffd166', '#ff7a45', '#3ddc97', '#c86bff', '#ff5c6c'] },
  sunset:  { name: 'Закат',    colors: ['#ff6b6b', '#ff9e6d', '#ffd166', '#f7567c', '#c44569', '#ffb385', '#e85d75', '#ffcf5c'] },
  ocean:   { name: 'Океан',    colors: ['#0077b6', '#00b4d8', '#48cae4', '#023e8a', '#00a6a6', '#90e0ef', '#0096c7', '#03045e'] },
  forest:  { name: 'Лес',      colors: ['#2d6a4f', '#40916c', '#95d5b2', '#52b788', '#1b4332', '#74c69d', '#b7e4c7', '#081c15'] },
  pastel:  { name: 'Пастель',  colors: ['#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff'] },
  casino:  { name: 'Казино',   colors: ['#c1121f', '#111111', '#c1121f', '#111111', '#c1121f', '#111111', '#0b6e4f', '#111111'] },
  mono:    { name: 'Нуар',     colors: ['#f5f5f5', '#1f1f1f', '#9a9a9a', '#3a3a3a', '#d4d4d4', '#2b2b2b'] },
};

const TAU = Math.PI * 2;

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export class Wheel {
  constructor(canvas, { onTick, onFrame } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.off = document.createElement('canvas');
    this.items = [];
    this.colors = PALETTES.neon.colors;
    this.rot = 0;
    this.highlight = -1;
    this.spinning = false;
    this.onTick = onTick;
    this.onFrame = onFrame;
    this.lightPhase = 0;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    this.idle();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = Math.round(this.canvas.clientWidth * dpr) || 600;
    if (size === this.size) return;
    this.size = size;
    this.canvas.width = this.canvas.height = size;
    this.render();
    this.draw();
  }

  setItems(items, colors) {
    this.items = items;
    if (colors) this.colors = colors;
    this.highlight = -1;
    this.render();
    this.draw();
  }

  setHighlight(i) { this.highlight = i; this.render(); this.draw(); }

  get geom() {
    const S = this.size, c = S / 2;
    const frame = S * 0.045;
    const R0 = c - 2;
    return { S, c, frame, R0, R: R0 - frame };
  }

  colorFor(i, n) {
    const cols = this.colors;
    let col = cols[i % cols.length];
    // не допускаем одинаковый цвет у первого и последнего сектора
    if (n > 1 && i === n - 1 && n % cols.length === 1) col = cols[(i + 1) % cols.length];
    return col;
  }

  // Рендер секторов во внеэкранный холст (в координатах колеса)
  render() {
    const { S, c, R } = this.geom;
    const off = this.off;
    off.width = off.height = S;
    const ctx = off.getContext('2d');
    ctx.clearRect(0, 0, S, S);
    const n = this.items.length;

    if (!n) {
      ctx.fillStyle = '#241845';
      ctx.beginPath(); ctx.arc(c, c, R, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.font = `700 ${S * 0.035}px Manrope, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('Добавьте игры во вкладке «Импорт»', c, c + R * 0.62);
      return;
    }

    const seg = TAU / n;
    for (let i = 0; i < n; i++) {
      const a0 = i * seg, a1 = a0 + seg;
      const col = this.colorFor(i, n);
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, R, a0, a1);
      ctx.closePath();
      const g = ctx.createRadialGradient(c, c, R * 0.15, c, c, R);
      g.addColorStop(0, shade(col, -0.35));
      g.addColorStop(0.55, col);
      g.addColorStop(1, shade(col, 0.12));
      ctx.fillStyle = g;
      ctx.fill();
      if (n > 1) {
        ctx.strokeStyle = 'rgba(255,255,255,.22)';
        ctx.lineWidth = Math.max(1, S * 0.002);
        ctx.stroke();
      }
    }

    // текст
    const fontSize = Math.max(9, Math.min(S * 0.034, seg * R * 0.42));
    const showText = seg * R * 0.9 > 8;
    if (showText) {
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = `800 ${fontSize}px Manrope, sans-serif`;
      // текст не должен заходить под центральный круг (его размер — this.hubFrac от диаметра)
      const hubR = (this.hubFrac || 0.34) * S / 2 + S * 0.03;
      const maxW = Math.max(R * 0.2, R - fontSize * 0.9 - hubR);
      for (let i = 0; i < n; i++) {
        const col = this.colorFor(i, n);
        const dark = luminance(col) > 0.45;
        ctx.save();
        ctx.translate(c, c);
        ctx.rotate((i + 0.5) * seg);
        ctx.fillStyle = dark ? '#1a1030' : '#fff';
        ctx.shadowColor = dark ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.55)';
        ctx.shadowBlur = fontSize * 0.25;
        // длинное название: сначала уменьшаем шрифт (до 65%), потом обрезаем
        const title = this.items[i].title;
        ctx.font = `800 ${fontSize}px Manrope, sans-serif`;
        const w = ctx.measureText(title).width;
        if (w > maxW) ctx.font = `800 ${Math.max(fontSize * 0.65, fontSize * maxW / w)}px Manrope, sans-serif`;
        ctx.fillText(fit(ctx, title, maxW), R - fontSize * 0.9, 0);
        ctx.restore();
      }
    }

    // объём
    const shine = ctx.createRadialGradient(c - R * 0.3, c - R * 0.35, R * 0.05, c, c, R);
    shine.addColorStop(0, 'rgba(255,255,255,.18)');
    shine.addColorStop(0.5, 'rgba(255,255,255,0)');
    shine.addColorStop(1, 'rgba(0,0,0,.28)');
    ctx.fillStyle = shine;
    ctx.beginPath(); ctx.arc(c, c, R, 0, TAU); ctx.fill();

    // подсветка выпавшего сектора
    if (this.highlight >= 0 && n > 1) {
      ctx.save();
      ctx.beginPath(); ctx.arc(c, c, R, 0, TAU);
      ctx.moveTo(c, c);
      ctx.arc(c, c, R, this.highlight * seg + seg, this.highlight * seg, true);
      ctx.closePath();
      ctx.fillStyle = 'rgba(8,4,18,.55)';
      ctx.fill('evenodd');
      ctx.restore();
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, R - 2, this.highlight * seg, this.highlight * seg + seg);
      ctx.closePath();
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = S * 0.008;
      ctx.stroke();
    }
  }

  draw() {
    const { S, c, frame, R0, R } = this.geom;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, S, S);

    // рама
    const rim = ctx.createLinearGradient(0, 0, S, S);
    rim.addColorStop(0, '#3b2a6e'); rim.addColorStop(0.5, '#1a1030'); rim.addColorStop(1, '#3b2a6e');
    ctx.fillStyle = rim;
    ctx.beginPath(); ctx.arc(c, c, R0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#ffd166'; ctx.lineWidth = S * 0.004;
    ctx.beginPath(); ctx.arc(c, c, R0 - ctx.lineWidth, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(c, c, R + ctx.lineWidth / 2, 0, TAU); ctx.stroke();

    // колесо
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(this.rot);
    ctx.drawImage(this.off, -c, -c);
    ctx.restore();

    // лампочки на раме
    const bulbs = 28, br = frame * 0.22, rr = R + frame / 2;
    const phase = Math.floor(this.lightPhase);
    for (let i = 0; i < bulbs; i++) {
      const a = (i / bulbs) * TAU;
      const x = c + Math.cos(a) * rr, y = c + Math.sin(a) * rr;
      const lit = this.spinning ? (i + phase) % 3 === 0 : (i + phase) % 2 === 0;
      ctx.beginPath(); ctx.arc(x, y, br, 0, TAU);
      if (lit) {
        ctx.fillStyle = '#fff6d6';
        ctx.shadowColor = '#ffd166'; ctx.shadowBlur = br * 4;
      } else {
        ctx.fillStyle = '#7a5a2a'; ctx.shadowBlur = 0;
      }
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    this.onFrame?.(this.rot);
  }

  // мигание лампочек в покое
  idle() {
    let last = 0;
    const loop = (t) => {
      if (!this.spinning && t - last > 650) {
        last = t; this.lightPhase++; this.draw();
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  indexAt(rot = this.rot) {
    const n = this.items.length;
    if (!n) return -1;
    const seg = TAU / n;
    let a = (-Math.PI / 2 - rot) % TAU;
    if (a < 0) a += TAU;
    return Math.floor(a / seg) % n;
  }

  spin(target, seconds = 8) {
    const n = this.items.length;
    if (!n || this.spinning) return Promise.resolve(-1);
    this.spinning = true;
    this.highlight = -1;
    this.render();
    const seg = TAU / n;
    const r = 0.12 + Math.random() * 0.76;
    const base = -Math.PI / 2 - (target + r) * seg;
    const minEnd = this.rot + (3 + seconds * 0.9) * TAU;
    const end = base + Math.ceil((minEnd - base) / TAU) * TAU;
    const start = this.rot, dur = seconds * 1000, t0 = performance.now();
    let lastIdx = this.indexAt(), lastTick = 0;

    return new Promise((resolve) => {
      const step = (now) => {
        const t = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - t, 4);
        this.rot = start + (end - start) * e;
        this.lightPhase += 0.25;
        this.draw();
        const idx = this.indexAt();
        if (idx !== lastIdx) {
          lastIdx = idx;
          if (now - lastTick > 40) { lastTick = now; this.onTick?.(); }
        }
        if (t < 1) requestAnimationFrame(step);
        else {
          this.rot = ((end % TAU) + TAU) % TAU;
          this.spinning = false;
          resolve(this.indexAt());
        }
      };
      requestAnimationFrame(step);
    });
  }
}

function fit(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + '…';
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
  r = Math.round((t - r) * p + r); g = Math.round((t - g) * p + g); b = Math.round((t - b) * p + b);
  return `rgb(${r},${g},${b})`;
}
