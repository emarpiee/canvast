// The soundtrack of the motion piece, synthesized here (no samples): a 120 bpm track in D minor whose bars line up with the cuts, and
// sound effects on the comp's cues (cues.json from render.mjs: whooshes, typing, clicks, the dive, the slams). Writes a 48 kHz stereo WAV.
// node scripts/showcase/motion/audio.mjs <cues.json> <out.wav> [seconds]
import { readFileSync, writeFileSync } from "node:fs";

const [cuesPath, outPath, durArg] = process.argv.slice(2);
const SR = 48000, DUR = Number(durArg) || 60, N = SR * DUR;
const L = new Float32Array(N), R = new Float32Array(N), RL = new Float32Array(N), RR = new Float32Array(N), DL = new Float32Array(N), DR = new Float32Array(N);
const duck = new Float32Array(N).fill(1);
let seed = 12345;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const noise = () => rnd() * 2 - 1;
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const S = (t) => Math.round(t * SR);
const pan = (p) => [Math.cos(((p + 1) * Math.PI) / 4), Math.sin(((p + 1) * Math.PI) / 4)];
function put(i, x, p = 0, rev = 0, dly = 0) {
  if (i < 0 || i >= N) return;
  const [a, b] = pan(p);
  L[i] += x * a; R[i] += x * b;
  if (rev) { RL[i] += x * a * rev; RR[i] += x * b * rev; }
  if (dly) { DL[i] += x * a * dly; DR[i] += x * b * dly; }
}
/** Chamberlin state-variable filter: returns [low, band, high] per call. */
function svf() { let low = 0, band = 0; return (x, fc, q = 0.7) => { const f = 2 * Math.sin((Math.PI * Math.min(fc, SR / 6)) / SR); low += f * band; const high = x - low - q * band; band += f * high; return [low, band, high]; }; }
function onePole() { let y = 0; return (x, a) => (y += a * (x - y)); }

// ---------------- instruments ----------------
function kick(t, v = 1) {
  const i0 = S(t); let ph = 0;
  for (let n = 0; n < S(0.5); n++) {
    const s = n / SR, f = 45 + 110 * Math.exp(-s * 28);
    ph += (2 * Math.PI * f) / SR;
    put(i0 + n, v * 0.9 * Math.sin(ph) * Math.exp(-s * 6.5) + (n < 90 ? v * 0.25 * noise() * (1 - n / 90) : 0), 0);
  }
  for (let n = 0; n < S(0.42); n++) { const i = i0 + n; if (i < N) duck[i] = Math.min(duck[i], 1 - 0.65 * Math.exp(-(n / SR) * 9)); }
}
function clap(t, v = 1) {
  const i0 = S(t), hp = svf();
  for (let n = 0; n < S(0.35); n++) {
    const s = n / SR, burst = s < 0.03 ? (Math.floor(s / 0.01) % 2 ? 0.5 : 1) : 1;
    const [, band] = hp(noise(), 1500, 0.9);
    put(i0 + n, v * 0.55 * band * burst * Math.exp(-s * 16) + v * 0.18 * Math.sin(2 * Math.PI * 190 * s) * Math.exp(-s * 30), 0.05, 0.3);
  }
}
function hat(t, v = 1, open = false, p = 0.25) {
  const i0 = S(t), f = svf();
  for (let n = 0; n < S(open ? 0.3 : 0.06); n++) { const s = n / SR, [, , high] = f(noise(), 7000, 0.6); put(i0 + n, v * 0.16 * high * Math.exp(-s * (open ? 11 : 70)), p, 0.08); }
}
function crash(t, v = 1) {
  const i0 = S(t), f = svf();
  for (let n = 0; n < S(2.2); n++) { const s = n / SR, [, , high] = f(noise(), 4000, 0.5); put(i0 + n, v * 0.2 * high * Math.exp(-s * 2.2), (rnd() - 0.5) * 0.6, 0.4); }
}
function bass(t, dur, m, v = 1) {
  const i0 = S(t), f0 = mtof(m), lp = svf(); let ph = 0;
  for (let n = 0; n < S(dur + 0.08); n++) {
    const s = n / SR; ph = (ph + f0 / SR) % 1;
    const saw = 2 * ph - 1, sub = Math.sin(2 * Math.PI * ph);
    const [low] = lp(saw, 180 + 900 * Math.exp(-s * 9), 0.5);
    const env = Math.min(1, s * 300) * (s > dur ? Math.max(0, 1 - (s - dur) / 0.08) : 1);
    const i = i0 + n; if (i >= N) break;
    put(i, v * 0.32 * (low * 0.7 + sub * 0.5) * env * duck[i], 0);
  }
}
function pad(t, dur, notes, v = 1) {
  const i0 = S(t);
  notes.forEach((m, k) => {
    const f0 = mtof(m), lp = svf(), p = (k / (notes.length - 1) - 0.5) * 1.1;
    const det = [-0.11, 0, 0.09].map((c) => f0 * 2 ** (c / 12)), ph = [rnd(), rnd(), rnd()];
    for (let n = 0; n < S(dur + 0.9); n++) {
      const s = n / SR; let x = 0;
      for (let j = 0; j < 3; j++) { ph[j] = (ph[j] + det[j] / SR) % 1; x += 2 * ph[j] - 1; }
      const [low] = lp(x / 3, 1100 + 500 * Math.sin(s * 1.3 + k), 0.8);
      const env = Math.min(1, s / 0.5) * (s > dur ? Math.max(0, 1 - (s - dur) / 0.9) : 1);
      const i = i0 + n; if (i >= N) break;
      put(i, v * 0.1 * low * env * (0.55 + 0.45 * duck[i]), p, 0.45);
    }
  });
}
/** A plucked string (Karplus-Strong). */
function pluck(t, m, v = 1, p = 0, len = 0.7) {
  const i0 = S(t), period = Math.max(2, Math.round(SR / mtof(m))), buf = new Float32Array(period);
  for (let k = 0; k < period; k++) buf[k] = noise();
  let idx = 0;
  for (let n = 0; n < S(len); n++) {
    const a = buf[idx], b = buf[(idx + 1) % period];
    buf[idx] = 0.497 * (a + b);
    idx = (idx + 1) % period;
    put(i0 + n, v * 0.22 * a * Math.min(1, (len - n / SR) * 10), p, 0.18, 0.3);
  }
}
function bell(t, m, v = 1, p = 0) {
  const i0 = S(t), f0 = mtof(m);
  const parts = [[1, 1, 1.6], [2.0, 0.45, 2.4], [2.76, 0.3, 3.4], [5.4, 0.18, 5], [8.93, 0.08, 7]];
  for (let n = 0; n < S(2.6); n++) {
    const s = n / SR; let x = 0;
    for (const [r, a, d] of parts) x += a * Math.sin(2 * Math.PI * f0 * r * s) * Math.exp(-s * d);
    put(i0 + n, v * 0.09 * x * Math.min(1, s * 400), p, 0.55, 0.25);
  }
}

// ---------------- sound effects ----------------
function whoosh(t, v = 1, dur = 0.5, lo = 300, hi = 3200, from = -0.7, to = 0.7) {
  const i0 = S(t), f = svf();
  for (let n = 0; n < S(dur); n++) {
    const u = n / S(dur), env = Math.sin(Math.PI * u) ** 2;
    const [, band] = f(noise(), lo * (hi / lo) ** Math.sin((Math.PI * u) / 2), 0.35);
    put(i0 + n, v * 0.42 * band * env, from + (to - from) * u, 0.15);
  }
}
function suck(t, v = 1, dur = 0.42) {
  const i0 = S(t), f = svf();
  for (let n = 0; n < S(dur); n++) { const u = n / S(dur), [, band] = f(noise(), 200 * 30 ** u, 0.3); put(i0 + n, v * 0.45 * band * u ** 2.5, 0, 0.2); }
}
function riser(t, dur, v = 1) {
  const i0 = S(t), f = svf(); let ph = 0;
  for (let n = 0; n < S(dur); n++) {
    const u = n / S(dur), [, band] = f(noise(), 250 * 24 ** u, 0.25);
    ph += (2 * Math.PI * (180 * 4 ** u)) / SR;
    put(i0 + n, v * (0.3 * band + 0.05 * Math.sin(ph)) * u ** 2, Math.sin(u * 9) * 0.3, 0.3);
  }
}
function scribble(t, dur, v = 1) {
  const i0 = S(t), f = svf(); let g = 0, gv = 0;
  for (let n = 0; n < S(dur); n++) {
    if (n % 900 === 0) gv = 0.3 + rnd() * 0.7;
    g += 0.004 * (gv - g);
    const [, band] = f(noise(), 2600 + 1400 * Math.sin(n / 1900), 0.5);
    const u = n / S(dur);
    put(i0 + n, v * 0.16 * band * g * Math.min(1, u * 12, (1 - u) * 12), 0.1, 0.1);
  }
}
function pop(t, v = 1) { const i0 = S(t); let ph = 0; for (let n = 0; n < S(0.09); n++) { const s = n / SR; ph += (2 * Math.PI * (300 + 700 * Math.exp(-s * 45))) / SR; put(i0 + n, v * 0.28 * Math.sin(ph) * Math.exp(-s * 38), 0.15, 0.25); } }
function click(t, v = 1) { const i0 = S(t); for (let n = 0; n < S(0.025); n++) { const s = n / SR; put(i0 + n, v * (0.22 * Math.sin(2 * Math.PI * 2300 * s) + 0.12 * noise()) * Math.exp(-s * 260), 0.2, 0.05); } }
function key(t, v = 1) {
  const i0 = S(t), f = svf(), pitch = 150 + rnd() * 70, p = (rnd() - 0.5) * 0.4;
  for (let n = 0; n < S(0.05); n++) { const s = n / SR, [, , high] = f(noise(), 3500, 0.6); put(i0 + n, v * (0.14 * high * Math.exp(-s * 300) + 0.16 * Math.sin(2 * Math.PI * pitch * s) * Math.exp(-s * 90)), p, 0.03); }
}
function tick(t, v = 1) { const i0 = S(t); for (let n = 0; n < S(0.05); n++) { const s = n / SR; put(i0 + n, v * 0.12 * Math.sin(2 * Math.PI * 1500 * s) * Math.exp(-s * 80), (rnd() - 0.5) * 0.8, 0.2); } }
function land(t, v = 1) {
  const i0 = S(t), lp = onePole(); let ph = 0;
  for (let n = 0; n < S(0.25); n++) { const s = n / SR; ph += (2 * Math.PI * (55 + 60 * Math.exp(-s * 30))) / SR; put(i0 + n, v * (0.45 * Math.sin(ph) * Math.exp(-s * 16) + 0.2 * lp(noise(), 0.15) * Math.exp(-s * 40)), 0, 0.15); }
}
function slap(t, v = 1) { land(t, v * 0.8); whoosh(t - 0.08, v * 0.5, 0.18, 600, 2400, -0.3, 0.3); }
function flip(t, v = 1) { whoosh(t, v * 0.8, 0.18, 500, 2500, -0.5, 0); whoosh(t + 0.2, v * 0.8, 0.2, 2500, 700, 0, 0.5); }
function brush(t, v = 1) { whoosh(t, v * 1.1, 0.75, 180, 1400, -0.9, 0.9); scribble(t + 0.05, 0.6, v * 1.4); }
function boom(t, v = 1) {
  kick(t, v * 1.2); crash(t, v * 0.9);
  const i0 = S(t), f = svf();
  for (let n = 0; n < S(1.4); n++) { const s = n / SR, [low] = f(Math.tanh(noise() * 3), 500, 0.4); put(i0 + n, v * 0.5 * low * Math.exp(-s * 3.5), 0, 0.6); }
}
function slam(t, v = 1) {
  kick(t, v * 1.15); crash(t, v * 0.6);
  const i0 = S(t); let ph = 0;
  for (let n = 0; n < S(0.6); n++) { const s = n / SR; ph += (2 * Math.PI * (90 + 80 * Math.exp(-s * 20))) / SR; put(i0 + n, v * 0.3 * Math.sin(ph) * Math.exp(-s * 7), 0, 0.35); }
}
/** The dive: a Shepard tone, a rise that never arrives, as the canvas never ends; it lands on a deep hit. */
function shepard(t, dur, v = 1) {
  const i0 = S(t), oct = 7, base = 40, ph = new Float64Array(oct);
  for (let n = 0; n < S(dur); n++) {
    const u = n / S(dur), s = n / SR, env = Math.min(1, u * 6) * Math.min(1, (1 - u) * 25);
    let x = 0;
    for (let k = 0; k < oct; k++) {
      const pos = (k + s * 0.55) % oct, f = base * 2 ** pos, a = Math.exp(-(((pos - oct / 2) / 1.6) ** 2));
      ph[k] += (2 * Math.PI * f) / SR; x += a * Math.sin(ph[k]);
    }
    put(i0 + n, v * 0.09 * x * env * (0.6 + 0.4 * u), Math.sin(s * 2.1) * 0.35, 0.35);
  }
  riser(t + dur - 2.2, 2.2, v * 0.7);
  boom(t + dur, v * 0.9);
}
function shimmer(t, v = 1) { [74, 77, 81, 84, 88, 89].forEach((m, k) => bell(t + k * 0.09, m, v * 0.9, (k / 5 - 0.5) * 1.2)); suck(t - 0.42, 0.6); }

// ---------------- the track: bars of 2 s ----------------
const CHORDS = [
  { pad: [50, 57, 60, 64, 65], root: 38, arp: [62, 65, 69, 72, 76, 72, 69, 65] }, // Dm9
  { pad: [46, 53, 57, 60, 62], root: 34, arp: [58, 62, 65, 69, 72, 69, 65, 62] }, // Bbmaj9
  { pad: [53, 57, 60, 67, 69], root: 41, arp: [65, 69, 72, 76, 79, 76, 72, 69] }, // Fadd9
  { pad: [48, 55, 57, 62, 64], root: 36, arp: [60, 64, 67, 69, 74, 69, 67, 64] }, // C6/9
];
const BEAT = 0.5;
const grooveOn = (t) => (t >= 4 && t < 39.5) || (t >= 46 && t < 52);
const bars = DUR / 2;
// kicks first: they set the ducking the bass and pad follow
for (let b = 0; b < bars; b++) for (let q = 0; q < 4; q++) { const t = b * 2 + q * BEAT; if (grooveOn(t)) kick(t, q === 0 ? 1 : 0.92); }
for (let b = 0; b < bars; b++) {
  const t0 = b * 2, ch = CHORDS[b % 4];
  const end = t0 >= 56;
  if (end) { if (t0 === 56) { pad(56, 3.3, CHORDS[0].pad.concat([69, 72]), 1.8); bass(56, 3.3, 38, 0.8); [62, 65, 69, 72, 76, 77, 81, 84].forEach((m, k) => pluck(56.6 + k * 0.25, m, 0.4 - k * 0.03, (k / 7 - 0.5), 0.9)); } continue; }
  pad(t0, 2, ch.pad, t0 < 4 ? 0.4 + t0 * 0.15 : t0 >= 38 && t0 < 46 ? 1.25 : t0 >= 52 ? 0.9 : 1);
  // bass
  if (t0 >= 4 && t0 < 52 && !(t0 >= 40 && t0 < 46)) {
    const r = ch.root;
    for (const [q, m, d] of [[0, r, 0.4], [1.5, r + 12, 0.18], [2, r, 0.4], [3, r + 7, 0.2], [3.5, r + 12, 0.18]]) bass(t0 + q * BEAT, d, m, t0 >= 38 ? 0.8 : 1);
  } else if (t0 >= 40 && t0 < 46) bass(t0, 1.9, ch.root, 0.6);
  else if (t0 >= 52 && t0 < 56) bass(t0, 1.9, ch.root, 0.7);
  // arpeggio: 16ths, quieter in the intro
  if (t0 >= 2 && t0 < 52) for (let k = 0; k < 16; k++) {
    const t = t0 + k * 0.125, m = ch.arp[k % 8] + (k >= 8 && t0 >= 46 ? 12 : 0);
    const vel = (t0 < 4 ? 0.35 : t0 >= 38 && t0 < 46 ? 0.55 + (t - 38) / 16 : 0.6) * (k % 4 === 0 ? 1 : 0.7);
    pluck(t, m, vel, Math.sin(k * 0.9) * 0.6, 0.45);
  }
  // drums on top of the kick
  for (let q = 0; q < 8; q++) {
    const t = t0 + q * 0.25;
    if (!grooveOn(t)) continue;
    if (q === 2 || q === 6) clap(t0 + q * 0.25, 0.9);
    hat(t + 0.125, q % 2 ? 0.9 : 0.7, q === 7 && b % 2 === 1);
    if (t0 >= 12) hat(t, 0.35, false, -0.3);
  }
  // a little lead on the second groove
  if (t0 >= 46 && t0 < 52) [[0, 74], [0.75, 76], [1.25, 77], [1.5, 81]].forEach(([q, m]) => bell(t0 + q, m + (b % 2 ? -2 : 0), 0.7, 0.3));
}
crash(4, 1); crash(22, 0.8); crash(46, 1);
// a snare roll into the breakdown
for (let k = 0; k < 8; k++) clap(38.5 + k * 0.125, 0.3 + k * 0.08);

// ---------------- the cues ----------------
const cues = JSON.parse(readFileSync(cuesPath, "utf8"));
const FX = { whoosh: (c) => whoosh(c.t, c.v), suck: (c) => suck(c.t, c.v), riser: (c) => riser(c.t, c.v, 0.5), scribble: (c) => scribble(c.t, c.v),
  pop: (c) => pop(c.t, c.v), click: (c) => click(c.t, c.v), key: (c) => key(c.t, c.v), tick: (c) => tick(c.t, c.v), land: (c) => land(c.t, c.v),
  slap: (c) => slap(c.t, c.v), flip: (c) => flip(c.t, c.v), brush: (c) => brush(c.t, c.v), boom: (c) => boom(c.t, c.v), slam: (c) => slam(c.t, c.v),
  dive: (c) => shepard(c.t, c.v, 1), shimmer: (c) => shimmer(c.t, c.v) };
// (riser, scribble and dive carry their length in v)
for (const c of cues) { const f = FX[c.k]; if (f) f(c); }

// ---------------- effects, mix, master ----------------
function delay() {
  const d = S(0.375), lpL = onePole(), lpR = onePole();
  for (let i = d; i < N; i++) { DL[i] += lpR(DR[i - d], 0.4) * 0.42; DR[i] += lpL(DL[i - d], 0.4) * 0.42; }
  for (let i = 0; i < N; i++) { L[i] += DR[i] * 0.45; R[i] += DL[i] * 0.45; }
}
function reverb() {
  const combs = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116].map((n) => Math.round((n * SR) / 44100));
  const aps = [225, 556, 441, 341].map((n) => Math.round((n * SR) / 44100));
  for (const [inp, out, spread] of [[RL, L, 0], [RR, R, 23]]) {
    const acc = new Float32Array(N);
    for (const c of combs) {
      const len = c + spread, buf = new Float32Array(len); let idx = 0, filt = 0;
      for (let i = 0; i < N; i++) { const y = buf[idx]; filt = y * 0.75 + filt * 0.25; buf[idx] = inp[i] + filt * 0.86; idx = (idx + 1) % len; acc[i] += y; }
    }
    for (const a of aps) {
      const len = a + spread, buf = new Float32Array(len); let idx = 0;
      for (let i = 0; i < N; i++) { const b = buf[idx], y = -acc[i] + b; buf[idx] = acc[i] + b * 0.5; idx = (idx + 1) % len; acc[i] = y; }
    }
    for (let i = 0; i < N; i++) out[i] += acc[i] * 0.05;
  }
}
delay();
reverb();
let peak = 0;
for (let i = 0; i < N; i++) {
  const fade = Math.min(1, i / (SR * 0.05), (N - i) / (SR * 0.5));
  L[i] = Math.tanh(L[i] * 1.1) * fade; R[i] = Math.tanh(R[i] * 1.1) * fade;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const g = 0.92 / (peak || 1), buf = Buffer.alloc(44 + N * 4);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(L[i] * g * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(R[i] * g * 32767), 46 + i * 4); }
writeFileSync(outPath, buf);
console.log(`sound: ${DUR} s, ${cues.length} cues, peak ${peak.toFixed(2)}`);
