// Records vertical 1080x1920 Instagram Reels of Lofty Lanterns being played by a bot.
// The real game (lantern-rise.html from the game repo) runs in headless Edge with its clock, random numbers and
// animation frames under our control, so a run can be searched quickly and then replayed frame by frame for capture.
// Sound is rebuilt from the game's own sound recipe (sfx calls are logged and synthesised here).
// usage: node make-reel.js <reel-name>        (reels are defined in REELS below)
const { chromium } = require('playwright-core');
const ffmpeg = require('ffmpeg-static');
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');

const GAME = process.env.GAME_HTML || 'C:/Users/mapab/Latern Rise/lantern-rise.html';
const ICON = process.env.GAME_ICON || 'C:/Users/mapab/Latern Rise/assets/icon-only.png';
const OUT = path.join(__dirname, '..', 'lofty-lanterns', 'reels');
const FPS = 30, VW = 390, VH = 693, DSF = 1080 / 390;

function gameHtml(dir) {
  let src = fs.readFileSync(GAME, 'utf8');
  const hook = `
  window.__T = { startRun, release, TIERS, W, DT, G, DRAG, LAST, liftAt,
    get state() { return state; }, get bodies() { return bodies; }, get blocks() { return blocks; }, get cur() { return cur; },
    get score() { return score; }, get combo() { return combo; }, get H() { return H; }, get launchY() { return launchY; },
    get windAx() { return windAx; }, get aimX() { return aimX; }, set aimX(v) { aimX = v; }, get topTier() { return topTier; } };
  for (const k of Object.keys(sfx)) { const f = sfx[k]; sfx[k] = (...a) => { (window.__sfx = window.__sfx || []).push([window.__vt, k, a]); return f(...a); }; }
`;
  const end = src.lastIndexOf('})();');
  src = src.slice(0, end) + hook + src.slice(end);
  const file = path.join(dir, 'game.html');
  fs.writeFileSync(file, src);
  return file;
}

// runs in the page before the game: seeded Math.random, and animation frames that only advance when we say so
function init(seed) {
  let s = seed >>> 0;
  Math.random = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  window.__q = []; window.__ts = 0; window.__vt = 0;
  window.requestAnimationFrame = cb => { window.__q.push(cb); return window.__q.length; };
  window.cancelAnimationFrame = () => {};
  window.__tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      window.__ts += 1000 / 30; window.__vt = window.__ts / 1000;
      const q = window.__q; window.__q = [];
      for (const cb of q) cb(window.__ts);
      if (window.__bot) window.__bot();
    }
  };
}

// the bot from tuning/sim.js, plus a visible, eased aim before each launch
function installBot(cfg) {
  const T = window.__T;
  function land(x, r) {
    let px = x, py = T.launchY, vx = 0, vy = -260 * T.DT;
    const wind = T.windAx * T.DT * T.DT, g = T.G * T.DT * T.DT;
    for (let i = 0; i < 400; i++) {
      vx = vx * T.DRAG + wind; vy = vy * T.DRAG + g * T.liftAt(px);
      const sp = Math.hypot(vx, vy); if (sp > 11) { vx *= 11 / sp; vy *= 11 / sp; }
      px = Math.max(r, Math.min(T.W - r, px + vx)); py += vy;
      if (py <= r) return { y: r, hit: null };
      for (const b of T.bodies) { const dx = b.x - px, dy = b.y - py, m = b.r + r; if (dx * dx + dy * dy < m * m) return { y: py, hit: b }; }
      for (const k of T.blocks) { if (k.on === false) continue; const dx = k.x - px, dy = k.y - py, m = k.r + r; if (dx * dx + dy * dy < m * m) return { y: py, hit: null, cloud: true }; }
    }
    return { y: py, hit: null };
  }
  function chooseAim(skill) {
    const c = T.cur, r = T.TIERS[c].r;
    let best = T.W / 2, bestS = -1e9;
    for (let x = r; x <= T.W - r; x += 6) {
      const res = land(x, r);
      let s = -res.y * 0.004;
      if (res.hit) {
        const d = res.hit.tier - c;
        if (d === 0 && res.hit.ice) s += .5;
        else if (d === 0) s += 10 + c * .5; else if (d === 1) s += 1.5; else if (d === -1) s += .8;
        else if (d <= -2) s -= Math.min(3, -d); else s -= .3 * d;
      } else if (res.cloud) s -= .5;
      if (s > bestS) { bestS = s; best = x; }
    }
    if (Math.random() > skill) best = r + Math.random() * (T.W - 2 * r);
    return best + (Math.random() + Math.random() - 1) * 5;
  }
  // Played like a person: uneven pauses, now and then a long think, aim that sometimes overshoots and is
  // pulled back, and a small hold before letting go.
  const st = { phase: 'wait', n: 0, wait: cfg.wait, from: 0, to: 0, len: 10, legs: [] };
  const R = (a, b) => a + Math.random() * (b - a);
  window.__bot = () => {
    if (T.state !== 'play' || T.cur === null) { st.phase = 'wait'; st.n = 0; return; }
    if (st.phase === 'wait') {
      if (++st.n >= st.wait) {
        const to = chooseAim(cfg.skill), from = T.aimX;
        st.legs = [];
        if (Math.random() < .3 && Math.abs(to - from) > 30) st.legs.push([to + Math.sign(to - from) * R(10, 28), R(7, 12) | 0]);
        st.legs.push([to, R(6, 14) | 0]);
        st.from = from; [st.to, st.len] = st.legs.shift(); st.phase = 'aim'; st.n = 0;
      }
    } else if (st.phase === 'aim') {
      st.n++;
      const k = Math.min(1, st.n / st.len), e = k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      T.aimX = st.from + (st.to - st.from) * e;
      if (k >= 1) {
        if (st.legs.length) { st.from = T.aimX; [st.to, st.len] = st.legs.shift(); st.n = 0; }
        else { st.phase = 'hold'; st.n = 0; st.len = R(1, 6) | 0; }
      }
    } else if (++st.n >= st.len) {
      T.release(); st.phase = 'wait'; st.n = 0;
      st.wait = Math.random() < .12 ? R(22, 40) | 0 : R(cfg.wait - 5, cfg.wait + 8) | 0;
    }
  };
}

function setOverlay(html) {
  let el = document.getElementById('reelOverlay');
  if (!el) {
    el = document.createElement('div'); el.id = 'reelOverlay';
    el.style.cssText = 'position:fixed;inset:0;z-index:99999;pointer-events:none;display:flex;flex-direction:column;align-items:center;font-family:"Lilita One",system-ui;color:#fff;text-align:center;';
    document.body.appendChild(el);
  }
  el.innerHTML = html || '';
}

// Plain text on a dark box, the way people caption Reels in the Instagram editor
const caption = (text, top = 46, size = 24) =>
  `<div style="position:absolute;top:${top}%;left:0;right:0;transform:translateY(-50%);display:flex;justify-content:center">` +
  `<span style="font-family:Figtree,system-ui;font-weight:700;font-size:${size}px;line-height:1.25;color:#fff;background:rgba(0,0,0,.62);` +
  `padding:5px 11px;border-radius:7px;max-width:78%">${text}</span></div>`;

function endCard(iconUri, line1, line2) {
  return `<div style="position:absolute;inset:0;background:#140e26;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px">` +
    `<img src="${iconUri}" style="width:112px;height:112px;border-radius:25px">` +
    `<div style="font-size:34px;color:#ffd27a">Lofty Lanterns</div>` +
    `<div style="font-family:Figtree,system-ui;font-weight:500;font-size:17px;color:#d8ccf2;max-width:80%">${line1}</div>` +
    (line2 ? `<div style="font-family:Figtree,system-ui;font-weight:500;font-size:15px;color:#a99bd0">${line2}</div>` : '') + `</div>`;
}

// ---- sound: the game's blip() recipe, rendered offline ----
const NOTES = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28];
// A cosy lo-fi loop written for these clips (no samples, nothing licensed): E major, 84 bpm,
// Emaj7 - C#m7 - Amaj7 - B6, chime arpeggio, pad, round bass and soft drums. Drums enter on bar 2;
// at gameEnd the band stops and the last chord rings out under the end card.
function music(SR, n, seconds, gameEnd) {
  const out = new Float32Array(n), beat = 60 / 84, bar = beat * 4;
  const hz = m => 440 * 2 ** ((m - 69) / 12);
  const CH = [[52, 56, 59, 63, 40], [49, 52, 56, 59, 37], [57, 61, 64, 68, 45], [47, 51, 54, 56, 47]];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const add = (t0, len, fn) => { const i0 = Math.max(0, Math.floor(t0 * SR)); for (let i = 0; i < len * SR && i0 + i < n; i++) out[i0 + i] += fn(i / SR); };
  const tone = (t0, f, len, vol, decay, harm = [1]) => add(t0, len, t => {
    const env = Math.min(1, t / .006) * Math.exp(-t / decay);
    let s = 0; harm.forEach((h, k) => { s += h * Math.sin(2 * Math.PI * f * (k + 1) * t); }); return s * env * vol;
  });
  const noise = (t0, len, vol, decay, bright) => { let lp = 0, prev = 0; add(t0, len, t => {
    const x = rnd() * 2 - 1; lp += (x - lp) * bright; const hp = lp - prev; prev = lp; return hp * Math.exp(-t / decay) * vol; }); };
  const end = Math.min(gameEnd, seconds);
  const bars = Math.ceil(end / bar);
  for (let b = 0; b < bars; b++) {
    const t0 = b * bar, c = CH[b % 4];
    // pad: slow swell over the bar
    for (const m of c.slice(0, 4)) add(t0, bar + .3, t => {
      const env = Math.min(1, t / .5) * Math.min(1, (bar + .3 - t) / .4);
      return .022 * env * (Math.sin(2 * Math.PI * hz(m) * t) + .25 * Math.sin(2 * Math.PI * hz(m) * 2.003 * t)) * (1 + .15 * Math.sin(2 * Math.PI * 3 * t));
    });
    // bass: root on 1, fifth-ish pickup on the "and" of 3
    tone(t0, hz(c[4]), beat * 2, .16, .5, [1, .35, .1]);
    tone(t0 + beat * 2.5, hz(c[4] + 7), beat * 1.4, .1, .35, [1, .3]);
    // electric piano (two-operator FM, like a Rhodes): a different broken-chord figure each bar, swung,
    // played a touch early or late with uneven velocity
    const figs = [[0, 2, 3, 2, null, 1, 3, null], [0, null, 2, 3, 1, null, 2, 3], [3, 2, 0, null, 2, 1, null, 3], [0, 1, null, 2, 3, null, 2, null]];
    const fig = figs[(b * 3 + (rnd() * 2 | 0)) % 4];
    for (let k = 0; k < 8; k++) {
      if (fig[k] === null) continue;
      const tt = t0 + k * beat / 2 + (k % 2 ? beat * .09 : 0) + (rnd() - .5) * .022;
      const f = hz(c[fig[k]] + 12), vel = .045 + rnd() * .035;
      add(tt, 1.3, t => {
        const env = Math.min(1, t / .004) * Math.exp(-t / .55), idx = 1.6 * Math.exp(-t / .18);
        return vel * env * Math.sin(2 * Math.PI * f * t + idx * Math.sin(2 * Math.PI * f * t) + .3 * Math.sin(2 * Math.PI * 7 * t) * .01);
      });
    }
    if (b === 0) continue;
    // drums: kick on 1 and 3 (+ a ghost before 3), soft clap on 2 and 4, hats on the offbeats
    for (const kb of [0, 2, b % 2 ? 1.75 : null]) if (kb !== null) add(t0 + kb * beat, .3, t => Math.sin(2 * Math.PI * (45 * t + 75 * .045 * (1 - Math.exp(-t / .045)))) * Math.exp(-t / .16) * (kb === 1.75 ? .18 : .34));
    for (const cb of [1, 3]) noise(t0 + cb * beat, .2, .06, .05, .18);
    for (let h = 0; h < 8; h++) if (h % 2) noise(t0 + h * beat / 2 + beat * .06, .05, .022, .012, .6);
  }
  // final chord rings out over the end card
  for (const m of CH[0].slice(0, 4)) tone(end, hz(m + 12), Math.max(.1, seconds - end), .045, 1.1, [1, .25]);
  tone(end, hz(CH[0][4]), Math.max(.1, seconds - end), .14, .9, [1, .3]);
  // tape: a soft high cut, slow wobble in level, and a faint bed of hiss and dust crackle
  let lp = 0, hiss = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    lp += (out[i] - lp) * .35;
    hiss += ((rnd() * 2 - 1) - hiss) * .2;
    const dust = rnd() < .00012 ? (rnd() - .5) * .06 : 0;
    out[i] = (lp * (1 + .03 * Math.sin(2 * Math.PI * .6 * t)) + hiss * .004 + dust) * Math.min(1, t / .25, (seconds - t) / .6);
  }
  return out;
}

function renderAudio(events, seconds, gameEnd = seconds) {
  const SR = 44100, n = Math.ceil(seconds * SR), buf = new Float32Array(n);
  const wave = (type, ph) => type === 'sine' ? Math.sin(ph) : type === 'triangle' ? 2 / Math.PI * Math.asin(Math.sin(ph)) : Math.sign(Math.sin(ph));
  function blip(t0, f, dur, type, vol, slideTo) {
    const i0 = Math.floor(t0 * SR), len = Math.floor((dur + .02) * SR);
    let ph = 0;
    for (let i = 0; i < len && i0 + i < n; i++) {
      const t = i / SR, k = Math.min(1, t / dur);
      const fr = slideTo ? f * (slideTo / f) ** k : f;
      ph += 2 * Math.PI * fr / SR;
      const gain = vol * (.0001 / vol) ** k, att = Math.min(1, t / .004);
      if (i0 + i >= 0) buf[i0 + i] += wave(type, ph) * gain * att;
    }
  }
  function noise(t0) {
    const i0 = Math.floor(t0 * SR), len = Math.floor(.6 * SR); let lp = 0, bp = 0;
    for (let i = 0; i < len && i0 + i < n; i++) {
      const t = i / SR, x = Math.random() * 2 - 1; lp += (x - lp) * .25; bp += (lp - bp) * .08;
      const env = t < .15 ? .0001 * (.18 / .0001) ** (t / .15) : .18 * (.0001 / .18) ** ((t - .15) / .45);
      buf[i0 + i] += (lp - bp) * env * 3;
    }
  }
  const S = {
    drop: t => blip(t, 240, .12, 'sine', .12, 150),
    merge: (t, tier, c) => { const f = 330 * 2 ** (NOTES[Math.min(NOTES.length - 1, tier + c - 1)] / 12); blip(t, f, .5, 'sine', .16); blip(t, f * 2, .3, 'triangle', .05); },
    gust: t => noise(t),
    sweep: t => blip(t, 900, .25, 'triangle', .1, 300),
    wish: t => blip(t, 520, .3, 'sine', .12, 1040),
    coin: t => { blip(t, 880, .09, 'triangle', .1); blip(t + .07, 1320, .14, 'triangle', .1); },
    win: t => [523, 659, 784, 1047].forEach((f, i) => blip(t + i * .11, f, .45, 'triangle', .12)),
    over: t => [392, 330, 262].forEach((f, i) => blip(t + i * .17, f, .5, 'triangle', .12))
  };
  for (const [t, k, a] of events) if (S[k]) S[k](t, ...(a || []));
  // sound effects sit under the music
  let sp = 0; for (const v of buf) sp = Math.max(sp, Math.abs(v));
  const mus = music(SR, n, seconds, gameEnd);
  for (let i = 0; i < n; i++) buf[i] = mus[i] + (sp ? buf[i] / sp * .45 : 0);
  let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0 ? .85 / peak : 1;
  const wav = Buffer.alloc(44 + n * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVE', 8); wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(SR, 24);
  wav.writeUInt32LE(SR * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) wav.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(buf[i] * gain * 32767))), 44 + i * 2);
  return wav;
}

// ---- reels ----
const REELS = {
  combo: {
    mode: 'free', seeds: [11, 23, 37, 41, 59, 71, 83, 97], search: 2700, clip: 12, endCard: 2.5,
    pick: 'combo',   // end the clip just after the biggest combo chain
    captions: (len) => [[0, 4, caption('wait for it')]],
    end: ['Free on iPhone', '']
  },
  daily: {
    mode: 'daily', date: '2026-12-01', seeds: [5, 17, 29, 43], search: 2400, clip: 11, endCard: 3,
    pick: 'combo',
    captions: (len) => [[0, 4.5, caption('the daily run: same sky for everyone, new one each day')]],
    end: ['Daily Lantern Run, all December', 'Free on iPhone']
  },
  moon: {
    mode: 'free', seeds: [3, 13, 31, 47, 61, 89], search: 3600, clip: 15, endCard: 2.5, speed: 8,
    pick: 'whole',   // a sped-up run from the very first spark
    captions: (len) => [[0, 3.5, caption('2 minutes of play at 8x speed')]],
    end: ['Free on iPhone', '']
  }
};

async function openGame(browser, file, seed, reel) {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DSF, hasTouch: true, isMobile: false });
  await ctx.addInitScript(init, seed);
  const page = await ctx.newPage();
  const url = 'file:///' + file.replace(/\\/g, '/') + (reel.date ? '?date=' + reel.date : '');
  await page.goto(url);
  await page.waitForFunction(() => window.__T && document.fonts && document.fonts.status === 'loaded', null, { timeout: 20000 });
  await page.evaluate(installBot, { skill: .97, wait: 13, aim: 10 });
  await page.evaluate(m => { window.__T.startRun(m); window.__sfx = []; }, reel.mode);
  return { ctx, page };
}

async function main() {
  const name = process.argv[2];
  const reel = REELS[name];
  if (!reel) throw new Error('reel name: ' + Object.keys(REELS).join(', '));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-'));
  // --audio: keep the recorded picture and only rebuild the sound from the saved sound events
  if (process.argv.includes('--audio')) {
    const mp4 = path.join(OUT, name + '.mp4'), snd = JSON.parse(fs.readFileSync(path.join(OUT, name + '.sound.json'), 'utf8'));
    const wav = path.join(tmp, 'audio.wav'), out = path.join(tmp, 'out.mp4');
    fs.writeFileSync(wav, renderAudio(snd.events, snd.seconds, snd.gameEnd));
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', mp4, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-shortest', '-movflags', '+faststart', out]);
    fs.copyFileSync(out, mp4); fs.rmSync(tmp, { recursive: true, force: true });
    return console.log('new sound for', mp4);
  }
  const file = gameHtml(tmp);
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const speed = reel.speed || 1;

  // 1. search: play each seed quickly and find the best moment
  let best = null;
  for (const seed of reel.seeds) {
    const { ctx, page } = await openGame(browser, file, seed, reel);
    let f = 0;
    while (f < reel.search) {
      await page.evaluate(() => window.__tick(150)); f += 150;
      if (await page.evaluate(() => window.__T.state !== 'play')) break;
    }
    const log = await page.evaluate(() => window.__sfx);
    const top = await page.evaluate(() => window.__T.topTier);
    await ctx.close();
    if (reel.pick === 'whole') {
      const dur = Math.min(f / FPS, reel.clip * speed);
      const s = top * 100 + dur;
      console.log(`seed ${seed}: top tier ${top}, ${Math.round(f / FPS)}s`);
      if (!best || s > best.score) best = { seed, start: 0, score: s };
      continue;
    }
    const merges = log.filter(e => e[1] === 'merge');
    for (const [t, , [tier, c]] of merges) {
      const s = c * 10 + tier;
      if (t < reel.clip - 2) continue;
      if (!best || s > best.score) best = { seed, start: t + 1.6 - reel.clip, score: s, combo: c, tier };
    }
    console.log(`seed ${seed}: best combo so far ${best ? best.combo : '-'} (top tier ${top})`);
  }
  console.log('chosen', best);

  // 2. replay the chosen run and capture it
  const frames = path.join(tmp, 'frames'); fs.mkdirSync(frames);
  const { ctx, page } = await openGame(browser, file, best.seed, reel);
  const skip = Math.round(best.start * FPS);
  for (let left = skip; left > 0; left -= 300) await page.evaluate(n => window.__tick(n), Math.min(300, left));
  await page.evaluate(() => { window.__sfx = []; window.__clip0 = window.__vt; });
  const total = Math.round(reel.clip * FPS), caps = reel.captions(reel.clip);
  let shown = null, idx = 0;
  for (let i = 0; i < total; i++) {
    const t = i / FPS, cap = caps.find(c => t >= c[0] && t < c[1]);
    const html = cap ? cap[2] : '';
    if (html !== shown) { await page.evaluate(setOverlay, html); shown = html; }
    await page.screenshot({ path: path.join(frames, String(idx++).padStart(5, '0') + '.jpg'), type: 'jpeg', quality: 92 });
    await page.evaluate(n => window.__tick(n), speed);
  }
  const log = await page.evaluate(() => window.__sfx.map(e => [e[0] - window.__clip0, e[1], e[2]]));
  // end card
  const iconUri = 'data:image/png;base64,' + fs.readFileSync(ICON).toString('base64');
  await page.evaluate(setOverlay, endCard(iconUri, ...reel.end));
  await page.waitForTimeout(300);
  const card = path.join(tmp, 'card.jpg');
  await page.screenshot({ path: card, type: 'jpeg', quality: 92 });
  for (let i = 0; i < Math.round(reel.endCard * FPS); i++) fs.copyFileSync(card, path.join(frames, String(idx++).padStart(5, '0') + '.jpg'));
  await ctx.close(); await browser.close();

  // 3. sound and encode
  const seconds = idx / FPS;
  // a sped-up clip keeps only the merges (drops would be a machine-gun rattle), squeezed onto the faster clock
  const events = speed > 1 ? log.filter(e => e[1] === 'merge').map(e => [e[0] / speed, e[1], e[2]]) : log;
  events.push([reel.clip + .15, 'win', []]);
  const wav = path.join(tmp, 'audio.wav');
  fs.writeFileSync(wav, renderAudio(events, seconds, reel.clip));
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name + '.sound.json'), JSON.stringify({ seconds, gameEnd: reel.clip, events }));
  const mp4 = path.join(OUT, name + '.mp4');
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, '%05d.jpg'), '-i', wav,
    '-vf', 'scale=1080:1920:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '18',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-shortest', '-movflags', '+faststart', mp4]);
  // a cover frame for review
  fs.copyFileSync(path.join(frames, String(Math.round(total * .85)).padStart(5, '0') + '.jpg'), path.join(OUT, name + '-cover.jpg'));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('wrote', mp4, seconds.toFixed(1) + 's');
}
main().catch(e => { console.error(e); process.exit(1); });
