// Realistic weather particles on a single canvas: rain, storm (+ lightning),
// snow, and a night sky with twinkling stars. Depth-layered particles,
// wind-dependent slant, capped DPR, paused when hidden.

const DPR_CAP = 2;

function rand(a, b) { return a + Math.random() * (b - a); }

export class WeatherFX {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.condition = null;
    this.isDay = true;
    this.windSlant = 0;        // -1..1, negative = streaks lean left
    this.windStrength = 0;     // 0..1
    this.particles = [];
    this.running = false;
    this.lastT = 0;
    this.flashAlpha = 0;
    this.nextFlash = 0;
    this.nextMeteor = 0;
    this.meteor = null;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.condition) this.build();
  }

  // relDeg: where the wind comes from relative to the car (0 = ahead,
  // 90 = right). Crosswind decides how far the rain/snow leans.
  setWind(relDeg, kmh) {
    if (relDeg == null) { this.windSlant = 0.12; this.windStrength = 0; return; }
    const cross = Math.sin(relDeg * Math.PI / 180); // + = from the right
    this.windStrength = Math.min((kmh || 0) / 90, 1);
    // wind from the right pushes drops to the left
    this.windSlant = -cross * (0.18 + this.windStrength * 0.55);
  }

  set(condition, isDay) {
    if (condition === this.condition && isDay === this.isDay) return;
    this.condition = condition;
    this.isDay = isDay;
    this.build();
    const active = ['rain', 'storm', 'snow'].includes(condition) ||
      (condition === 'clear' && !isDay);
    if (active && !this.reduced) this.start();
    else this.stop();
  }

  build() {
    const P = this.particles = [];
    const area = this.w * this.h / (390 * 700); // scale counts with viewport
    const c = this.condition;

    if (c === 'rain' || c === 'storm') {
      const n = Math.round((c === 'storm' ? 260 : 170) * area);
      for (let i = 0; i < n; i++) {
        const z = rand(0.35, 1); // depth: far -> near
        P.push({
          x: rand(-0.2, 1.2) * this.w,
          y: rand(0, this.h),
          z,
          len: (16 + z * 30) * (c === 'storm' ? 1.3 : 1),
          speed: (780 + z * 1050) * (c === 'storm' ? 1.3 : 1),
          alpha: 0.13 + z * 0.4,
          thick: 0.7 + z * 0.9,
        });
      }
      this.nextFlash = performance.now() + rand(2500, 7000);
    } else if (c === 'snow') {
      const n = Math.round(150 * area);
      for (let i = 0; i < n; i++) {
        const z = rand(0.3, 1);
        P.push({
          x: rand(0, this.w),
          y: rand(0, this.h),
          z,
          r: 0.8 + z * 2.6,
          speed: 36 + z * 86,
          alpha: 0.25 + z * 0.6,
          phase: rand(0, Math.PI * 2),
          sway: 14 + z * 26,
        });
      }
    } else if (c === 'clear' && !this.isDay) {
      const n = Math.round(130 * area);
      for (let i = 0; i < n; i++) {
        P.push({
          x: rand(0, this.w),
          y: rand(0, this.h * 0.85),
          r: rand(0.4, 1.4),
          alpha: rand(0.25, 0.9),
          phase: rand(0, Math.PI * 2),
          tw: rand(0.4, 1.6), // twinkle speed
        });
      }
      this.nextMeteor = performance.now() + rand(8000, 25000);
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastT = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.ctx.clearRect(0, 0, this.w, this.h);
  }

  frame(t) {
    if (!this.running) return;
    this.raf = requestAnimationFrame((tt) => this.frame(tt));
    if (document.hidden) return;
    const dt = Math.min((t - this.lastT) / 1000, 0.1);
    this.lastT = t;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);

    const c = this.condition;
    if (c === 'rain' || c === 'storm') this.drawRain(ctx, dt, t, c === 'storm');
    else if (c === 'snow') this.drawSnow(ctx, dt, t);
    else if (c === 'clear' && !this.isDay) this.drawStars(ctx, dt, t);
  }

  drawRain(ctx, dt, t, storm) {
    const slant = this.windSlant + (storm ? Math.sin(t / 900) * 0.08 : 0); // gusts
    ctx.lineCap = 'round';
    for (const p of this.particles) {
      const vx = p.speed * slant;
      p.y += p.speed * dt;
      p.x += vx * dt;
      if (p.y - p.len > this.h) {
        p.y = -p.len - rand(0, 40);
        p.x = rand(-0.2, 1.2) * this.w;
      }
      if (p.x < -this.w * 0.25) p.x += this.w * 1.4;
      if (p.x > this.w * 1.25) p.x -= this.w * 1.4;

      const dx = slant * p.len;
      const grad = ctx.createLinearGradient(p.x - dx, p.y - p.len, p.x, p.y);
      grad.addColorStop(0, 'rgba(200, 222, 255, 0)');
      grad.addColorStop(1, `rgba(205, 225, 255, ${p.alpha})`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = p.thick;
      ctx.beginPath();
      ctx.moveTo(p.x - dx, p.y - p.len);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }

    // lightning
    if (storm) {
      if (t >= this.nextFlash) {
        this.flashAlpha = rand(0.18, 0.32);
        this.nextFlash = t + (this.flashAlpha > 0.28 ? rand(90, 160) : rand(4000, 11000));
      }
      if (this.flashAlpha > 0.004) {
        ctx.fillStyle = `rgba(225, 235, 255, ${this.flashAlpha})`;
        ctx.fillRect(0, 0, this.w, this.h);
        this.flashAlpha *= Math.pow(0.0001, dt); // fast decay
      }
    }
  }

  drawSnow(ctx, dt, t) {
    for (const p of this.particles) {
      p.phase += dt * (0.6 + p.z);
      p.y += p.speed * dt;
      p.x += (Math.sin(p.phase) * p.sway + this.windSlant * 160 * p.z) * dt;
      if (p.y - p.r > this.h) { p.y = -p.r - rand(0, 30); p.x = rand(0, this.w); }
      if (p.x < -10) p.x += this.w + 20;
      if (p.x > this.w + 10) p.x -= this.w + 20;

      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawStars(ctx, dt, t) {
    for (const p of this.particles) {
      const tw = 0.55 + 0.45 * Math.sin(t / 1000 * p.tw + p.phase);
      ctx.globalAlpha = p.alpha * tw;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // rare shooting star
    if (!this.meteor && t >= this.nextMeteor) {
      this.meteor = {
        x: rand(0.15, 0.85) * this.w, y: rand(0.05, 0.3) * this.h,
        vx: rand(260, 420) * (Math.random() < 0.5 ? -1 : 1), vy: rand(130, 210),
        life: 0.9,
      };
      this.nextMeteor = t + rand(20000, 55000);
    }
    const m = this.meteor;
    if (m) {
      m.life -= dt;
      m.x += m.vx * dt; m.y += m.vy * dt;
      const a = Math.max(m.life, 0) * 0.8;
      const grad = ctx.createLinearGradient(m.x - m.vx * 0.12, m.y - m.vy * 0.12, m.x, m.y);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(1, `rgba(255,255,255,${a})`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(m.x - m.vx * 0.12, m.y - m.vy * 0.12);
      ctx.lineTo(m.x, m.y);
      ctx.stroke();
      if (m.life <= 0) this.meteor = null;
    }
  }
}
