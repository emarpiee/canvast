// SVG scenes for the cosmos showcase. Every scene is drawn in screen px at the zoom it is pasted at.
let seed = 7;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const f = (n) => Math.round(n * 100) / 100;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const svg = (w, h, body, defs = "") => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs}</defs>${body}</svg>`;
const radial = (id, stops, cx = 0.5, cy = 0.5) => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="0.5">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join("")}</radialGradient>`;
const linear = (id, stops, x2 = 1, y2 = 0) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join("")}</linearGradient>`;
const stars = (n, w, h, avoid = () => false) => {
  let s = "";
  for (let i = 0; i < n; i++) {
    const x = rnd() * w, y = rnd() * h;
    if (avoid(x, y)) continue;
    s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.4 + rnd() ** 3 * 1.6)}" fill="${pick(["#ffffff", "#cfe3ff", "#ffe8c2", "#ffffff"])}" opacity="${f(0.25 + rnd() * 0.75)}"/>`;
  }
  return s;
};
const sparkle = (x, y, r, c = "#ffffff") => `<path d="M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r}Z" fill="${c}"/>`;

// ── 1. The Solar System (home, level 0): 1400 × 860 ─────────────────────────────────────────
export const SUN = [330, 430];
export const orbit = (rx, t) => [SUN[0] + rx * Math.cos(t), SUN[1] + rx * 0.38 * Math.sin(t)];
export const PLANETS = {
  mercury: { rx: 150, t: 2.3, r: 6 },
  venus: { rx: 230, t: 0.9, r: 10 },
  earth: { rx: 330, t: -0.55, r: 14 },
  mars: { rx: 430, t: 2.0, r: 9 },
  jupiter: { rx: 600, t: 0.42, r: 36 },
  saturn: { rx: 820, t: -0.28, r: 26 },
};
for (const p of Object.values(PLANETS)) p.at = orbit(p.rx, p.t);
export const DIPPER = [[1010, 560], [1065, 585], [1112, 600], [1160, 625], [1172, 690], [1250, 700], [1262, 640]];

export function solarSystem() {
  let defs_clip;
  const W = 1400, H = 860;
  const defs = [
    radial("space", [[0, "#1c2a6e"], [0.45, "#0b1238"], [1, "#03040d"]], 0.3, 0.5),
    radial("neb1", [[0, "#7b2ff7", 0.45], [1, "#7b2ff7", 0]]),
    radial("neb2", [[0, "#00b4d8", 0.35], [1, "#00b4d8", 0]]),
    radial("neb3", [[0, "#f72585", 0.3], [1, "#f72585", 0]]),
    radial("glow", [[0, "#ffd166", 0.75], [0.4, "#fb8500", 0.3], [1, "#fb8500", 0]]),
    radial("sun", [[0, "#fffbe6"], [0.35, "#ffd166"], [1, "#f77f00"]], 0.4, 0.38),
    radial("mercury", [[0, "#e0e0e0"], [1, "#6c6c6c"]], 0.35, 0.35),
    radial("venus", [[0, "#fff1c1"], [1, "#d08c34"]], 0.35, 0.35),
    radial("earth", [[0, "#8fe3ff"], [0.5, "#2b8cd6"], [1, "#0b2f6b"]], 0.35, 0.35),
    radial("mars", [[0, "#ffb38a"], [1, "#9c2f1a"]], 0.35, 0.35),
    linear("jupiter", [[0, "#f3d9b1"], [0.18, "#c58f5a"], [0.32, "#f6e3c4"], [0.48, "#b5703f"], [0.6, "#f0d2a8"], [0.75, "#c9925e"], [1, "#8a5532"]], 0, 1),
    radial("jshade", [[0, "#000000", 0], [0.7, "#000000", 0], [1, "#000000", 0.45]], 0.4, 0.4),
    linear("saturn", [[0, "#f7e6b5"], [0.5, "#d8b56e"], [1, "#9b7a3d"]], 0, 1),
  ].join("");
  let b = `<rect width="${W}" height="${H}" rx="36" fill="url(#space)"/>`;
  defs_clip = `<clipPath id="panel"><rect width="${W}" height="${H}" rx="36"/></clipPath>`;
  b += `<g clip-path="url(#panel)"><ellipse cx="1080" cy="230" rx="330" ry="170" fill="url(#neb1)"/><ellipse cx="1250" cy="330" rx="200" ry="150" fill="url(#neb3)"/><ellipse cx="760" cy="720" rx="360" ry="140" fill="url(#neb2)"/>`;
  b += stars(330, W, H, (x, y) => x < 14 || y < 14 || x > W - 14 || y > H - 14);
  for (const [x, y, r] of [[120, 110, 7], [1310, 90, 6], [930, 790, 5], [610, 140, 4]]) b += sparkle(x, y, r, "#fff7e0");
  for (const [x, y] of DIPPER) b += `<circle cx="${x}" cy="${y}" r="2.6" fill="#fff4dc"/>` + sparkle(x, y, 6, "#fff4dc");
  for (const p of Object.values(PLANETS)) b += `<ellipse cx="${SUN[0]}" cy="${SUN[1]}" rx="${p.rx}" ry="${f(p.rx * 0.38)}" fill="none" stroke="#9fb4ff" stroke-opacity="0.35" stroke-width="1.2" stroke-dasharray="3 7"/>`;
  b += `</g>`;
  b += `<circle cx="${SUN[0]}" cy="${SUN[1]}" r="200" fill="url(#glow)"/><circle id="Sun" cx="${SUN[0]}" cy="${SUN[1]}" r="78" fill="url(#sun)"/>`;
  for (const [name, p] of Object.entries(PLANETS)) {
    if (name === "saturn") continue;
    b += `<circle id="${name[0].toUpperCase() + name.slice(1)}" cx="${f(p.at[0])}" cy="${f(p.at[1])}" r="${p.r}" fill="url(#${name})"/>`;
    if (name === "jupiter") b += `<circle cx="${f(p.at[0])}" cy="${f(p.at[1])}" r="${p.r}" fill="url(#jshade)"/><ellipse cx="${f(p.at[0] + 10)}" cy="${f(p.at[1] + 9)}" rx="6" ry="3.5" fill="#c0563b"/>`;
  }
  const s = PLANETS.saturn.at;
  b += `<circle id="Saturn" cx="${f(s[0])}" cy="${f(s[1])}" r="${PLANETS.saturn.r}" fill="url(#saturn)"/>`;
  return svg(W, H, b, defs + defs_clip);
}

/** Saturn's ring: two ellipses, made one by Exclude. Centred in a 160 × 80 box. */
export const saturnRing = () =>
  svg(160, 80, `<ellipse cx="80" cy="40" rx="62" ry="15" fill="#e9d8a6" opacity="0.92" transform="rotate(-14 80 40)"/><ellipse cx="80" cy="40" rx="42" ry="9" fill="#e9d8a6" transform="rotate(-14 80 40)"/>`);

// ── 2. Earth and the Moon (level +4): Earth's centre at screen (430, 450) ────────────────────
export const EARTH_SCREEN = [430, 450];
export function earthScene() {
  const W = 1440, H = 900, [cx, cy] = EARTH_SCREEN, R = 224;
  const defs = [
    radial("ocean", [[0, "#5fd3ff"], [0.55, "#1f77c9"], [1, "#082a5e"]], 0.36, 0.34),
    radial("atmo", [[0, "#7fdcff", 0], [0.86, "#7fdcff", 0], [0.93, "#7fdcff", 0.55], [1, "#7fdcff", 0]]),
    radial("night", [[0, "#000814", 0], [0.6, "#000814", 0], [1, "#000814", 0.75]], 0.3, 0.3),
    `<clipPath id="disc"><circle cx="${cx}" cy="${cy}" r="${R}"/></clipPath>`,
  ].join("");
  const blob = (x, y, s, rot, c) => `<path transform="translate(${x} ${y}) rotate(${rot}) scale(${s})" d="M0-40C22-46 46-30 52-6C58 18 38 26 30 44C22 62-4 70-20 52C-34 36-58 34-56 8C-54-18-24-34 0-40Z" fill="${c}"/>`;
  let land = "";
  land += blob(cx - 90, cy - 60, 1.7, 20, "#3a9d5d") + blob(cx - 30, cy + 40, 1.2, -30, "#4caf50") + blob(cx + 110, cy - 110, 1.3, 70, "#5a9e48");
  land += blob(cx + 140, cy + 90, 1.0, 10, "#c9a66b") + blob(cx - 150, cy + 130, 0.8, 45, "#2e8b57") + blob(cx + 40, cy - 170, 0.7, -10, "#e8eef2");
  land += blob(cx + 20, cy + 205, 1.1, 0, "#f1f5f9");
  let clouds = "";
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2, d = rnd() * R * 0.9;
    clouds += `<ellipse cx="${f(cx + d * Math.cos(a))}" cy="${f(cy + d * Math.sin(a))}" rx="${f(30 + rnd() * 60)}" ry="${f(6 + rnd() * 10)}" fill="#ffffff" opacity="${f(0.35 + rnd() * 0.4)}" transform="rotate(${f(-20 + rnd() * 40)} ${f(cx + d * Math.cos(a))} ${f(cy + d * Math.sin(a))})"/>`;
  }
  let b = `<circle cx="${cx}" cy="${cy}" r="${R + 34}" fill="url(#atmo)"/>`;
  b += `<g clip-path="url(#disc)"><circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#ocean)"/>${land}${clouds}<circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#night)"/></g>`;
  b += `<path d="M${cx + 150} ${cy - 170} C ${cx + 330} ${cy - 400}, ${cx + 560} ${cy - 330}, 1060 260" fill="none" stroke="#ffd6a5" stroke-width="2" stroke-dasharray="2 9" stroke-linecap="round"/>`;
  return svg(W, H, b, defs);
}
/** The Moon: a disc and a cutter, made a crescent by Subtract. Centred in 220 × 220. */
export const moon = () => {
  const defs = radial("moon", [[0, "#f4f1ea"], [1, "#9a958c"]], 0.35, 0.35);
  return svg(220, 220, `<circle cx="110" cy="110" r="70" fill="url(#moon)"/><circle cx="140" cy="92" r="62" fill="#000000"/>`, defs);
};
export const craters = () => svg(220, 220, [[58, 120, 11], [80, 160, 8], [62, 82, 6], [96, 186, 5]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#8a857c" opacity="0.55"/>`).join(""));
export const CRATER = [80, 160]; // in the moon box: the deep dive goes into this crater
/** A rocket made of five parts, made one shape by Union, plus a window and a flame. Centred in 120 × 220. */
export const rocketParts = () => {
  const body = `<path d="M60 10 C 92 44, 96 110, 86 160 L 34 160 C 24 110, 28 44, 60 10 Z" fill="#f1f5f9"/>`;
  const finL = `<path d="M36 118 L 10 170 L 38 160 Z" fill="#f1f5f9"/>`, finR = `<path d="M84 118 L 110 170 L 82 160 Z" fill="#f1f5f9"/>`;
  const nozzle = `<rect x="44" y="156" width="32" height="14" rx="3" fill="#f1f5f9"/>`;
  return svg(120, 220, body + finL + finR + nozzle);
};
export const rocketDetails = () => {
  const defs = linear("flame", [[0, "#fff3b0"], [0.5, "#ffb703"], [1, "#f72585", 0]], 0, 1) + radial("glass", [[0, "#bde0fe"], [1, "#1d3557"]], 0.35, 0.35);
  return svg(120, 220, `<circle cx="60" cy="74" r="14" fill="#e63946"/><circle cx="60" cy="74" r="10" fill="url(#glass)"/><path d="M46 170 Q60 222 74 170 Z" fill="url(#flame)"/><path d="M60 10 C 70 20, 77 30, 81 40 L 39 40 C 43 30, 50 20, 60 10 Z" fill="#e63946"/>`, defs);
};

// ── 3. A galaxy 1,000 levels down (inside a crater of the Moon) ─────────────────────────────
export function galaxy() {
  const W = 2400, H = 1600, cx = 1200, cy = 800;
  const defs = [
    radial("deep", [[0, "#1a0b3d"], [0.55, "#08051a"], [1, "#020108"]]),
    radial("core", [[0, "#fffbe6"], [0.3, "#ffd6a5", 0.85], [1, "#ff7b00", 0]]),
    radial("halo", [[0, "#9d4edd", 0.28], [1, "#9d4edd", 0]]),
  ].join("");
  let b = `<rect width="${W}" height="${H}" fill="url(#deep)"/>` + stars(420, W, H);
  b += `<ellipse id="Halo" cx="${cx}" cy="${cy}" rx="700" ry="430" fill="url(#halo)"/>`;
  const arms = 2, tilt = 0.62, turn = -0.35;
  const put = (r, a) => { const x = r * Math.cos(a), y = r * Math.sin(a) * tilt; return [cx + x * Math.cos(turn) - y * Math.sin(turn), cy + x * Math.sin(turn) + y * Math.cos(turn)]; };
  for (let k = 0; k < arms; k++) {
    for (let i = 0; i < 700; i++) {
      const t = (i / 700) * 3.3 * Math.PI, base = 26 * Math.exp(0.285 * t);
      const spread = 0.12 + 0.1 * (i / 700);
      const r = base * (1 + (rnd() - 0.5) * spread * 2), a = t + k * Math.PI + (rnd() - 0.5) * spread * 2;
      const [x, y] = put(r, a);
      const c = r < 90 ? pick(["#fff1c1", "#ffd6a5", "#ffffff"]) : pick(["#a2d2ff", "#cdb4db", "#ffffff", "#bde0fe", "#a2d2ff"]);
      b += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.7 + rnd() ** 3 * 2.6)}" fill="${c}" opacity="${f(0.35 + rnd() * 0.65)}"/>`;
      if (r > 120 && rnd() < 0.035) b += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(5 + rnd() * 8)}" fill="#ff8fab" opacity="0.22"/>`;
    }
  }
  for (let i = 0; i < 260; i++) { const [x, y] = put(rnd() * 95, rnd() * Math.PI * 2); b += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.6 + rnd() * 1.4)}" fill="#fff4d6" opacity="${f(0.4 + rnd() * 0.6)}"/>`; }
  const [ex, ey] = put(0, 0);
  b += `<ellipse id="Core" cx="${f(ex)}" cy="${f(ey)}" rx="92" ry="58" fill="url(#core)" transform="rotate(${f((turn * 180) / Math.PI)} ${f(ex)} ${f(ey)})"/>`;
  return svg(W, H, b, defs);
}

// ── 4. The cosmic web (level −14): a backdrop sent to the back ──────────────────────────────
export function cosmicWeb() {
  const W = 1400, H = 860, cx = 700, cy = 430;
  const defs = [radial("void", [[0, "#0d1440"], [0.5, "#060a24"], [1, "#010208"]]), radial("cl", [[0, "#ffe5b4", 0.9], [0.3, "#ff9e7a", 0.4], [1, "#7b2ff7", 0]])].join("");
  let b = `<rect width="${W}" height="${H}" rx="36" fill="url(#void)"/>`;
  const nodes = [[cx, cy]];
  while (nodes.length < 46) nodes.push([60 + rnd() * (W - 120), 60 + rnd() * (H - 120)]);
  const edges = [];
  for (let i = 0; i < nodes.length; i++) {
    const near = nodes.map((n, j) => [Math.hypot(n[0] - nodes[i][0], n[1] - nodes[i][1]), j]).sort((a, c) => a[0] - c[0]).slice(1, 4);
    for (const [, j] of near) if (i < j) edges.push([i, j]);
  }
  for (const [i, j] of edges) {
    const [x1, y1] = nodes[i], [x2, y2] = nodes[j], n = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 7);
    for (let s = 0; s < n; s++) {
      const u = rnd(), x = x1 + (x2 - x1) * u + (rnd() - 0.5) * 16, y = y1 + (y2 - y1) * u + (rnd() - 0.5) * 16;
      b += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.5 + rnd() * 1.3)}" fill="${pick(["#9bb1ff", "#c77dff", "#7ae7ff", "#ffffff"])}" opacity="${f(0.25 + rnd() * 0.55)}"/>`;
    }
  }
  for (const [x, y] of nodes.slice(1)) b += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(10 + rnd() * 22)}" fill="url(#cl)"/>`;
  b += `<circle cx="${cx}" cy="${cy}" r="26" fill="none" stroke="#ffd166" stroke-width="2" stroke-dasharray="4 5"/>`;
  return svg(W, H, b, defs);
}
