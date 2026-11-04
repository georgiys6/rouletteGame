// Звуки (WebAudio, без файлов) и конфетти.

let actx;
function ac() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === 'suspended') actx.resume();
  return actx;
}

function blip(freq, dur, type = 'square', vol = 0.06, when = 0) {
  const a = ac();
  const t = a.currentTime + when;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

export const sound = {
  enabled: true,
  unlock() { try { ac(); } catch {} },
  tick() { if (this.enabled) try { blip(1400 + Math.random() * 300, 0.035, 'triangle', 0.08); } catch {} },
  win() {
    if (!this.enabled) return;
    try { [523, 659, 784, 1047].forEach((f, i) => blip(f, 0.25, 'triangle', 0.09, i * 0.11)); blip(1568, 0.6, 'sine', 0.06, 0.45); } catch {}
  },
  out() {
    if (!this.enabled) return;
    try { blip(220, 0.18, 'sawtooth', 0.05); blip(150, 0.3, 'sine', 0.08, 0.08); } catch {}
  },
};

export function confetti(canvas, { count = 180 } = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const colors = ['#ff4d9d', '#7c5cff', '#00c2ff', '#ffd166', '#3ddc97', '#ffffff'];
  const W = innerWidth, H = innerHeight;
  const parts = Array.from({ length: count }, (_, i) => {
    const fromLeft = i % 2 === 0;
    return {
      x: fromLeft ? -10 : W + 10, y: H * (0.55 + Math.random() * 0.3),
      vx: (fromLeft ? 1 : -1) * (6 + Math.random() * 10), vy: -(10 + Math.random() * 12),
      w: 6 + Math.random() * 8, h: 4 + Math.random() * 6,
      r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
      c: colors[(Math.random() * colors.length) | 0], life: 0,
    };
  });
  const t0 = performance.now();
  const step = (now) => {
    ctx.clearRect(0, 0, W, H);
    let alive = false;
    for (const p of parts) {
      p.vy += 0.35; p.vx *= 0.985; p.vy *= 0.99;
      p.x += p.vx; p.y += p.vy; p.r += p.vr;
      if (p.y < H + 20) alive = true;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)));
      ctx.restore();
    }
    if (alive && now - t0 < 6000) requestAnimationFrame(step);
    else ctx.clearRect(0, 0, W, H);
  };
  requestAnimationFrame(step);
}
