// The scenes of the showcase: a "powers of two" journey. Every scene is an SVG of 1800 × 1124 shown 1:1 at its zoom level, centred on its
// own point; the next scene down sits inside it at `portal` (SVG units), drawn by that scene, so the parent keeps the area around the portal
// clear (CLEAR) and only marks it with a ring. Labels are [x, y, text, size, colour] in SVG units of the scene.
let seed = 11;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const f = (n) => Math.round(n * 100) / 100;
const pick = (a) => a[Math.floor(rnd() * a.length)];
export const W = 1800, H = 1124, CX = 900, CY = 562;
const svg = (body, defs = "") => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs>${body}</svg>`;
const stops = (s) => s.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join("");
const radial = (id, s, cx = 0.5, cy = 0.5) => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="0.5">${stops(s)}</radialGradient>`;
const linear = (id, s, x2 = 1, y2 = 0) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops(s)}</linearGradient>`;
/** The scene's own ground: a soft disc much wider than the view (from far above it is a soft dot: what the scene looks like from there). */
const ground = (c, r = 1500) => ({ defs: radial("ground", [[0, c], [0.72, c], [1, c, 0]]), body: `<circle cx="${CX}" cy="${CY}" r="${r}" fill="url(#ground)"/>` });
/** Away from the portal (and its clear zone) and from the title. */
const away = (x, y, portal, clear) => (!portal || Math.hypot(x - portal[0], y - portal[1]) > clear) && !(x < 980 && y < 300);
const stars = (n, portal, clear, opts = {}) => {
  const { cols = ["#ffffff", "#cfe3ff", "#ffe8c2"], rmax = 1.6, x0 = 180, x1 = 1620, y0 = 112, y1 = 1012 } = opts;
  let s = "";
  for (let i = 0; i < n; i++) {
    const x = x0 + rnd() * (x1 - x0), y = y0 + rnd() * (y1 - y0);
    if (!away(x, y, portal, clear)) continue;
    s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.4 + rnd() ** 3 * rmax)}" fill="${pick(cols)}" opacity="${f(0.25 + rnd() * 0.75)}"/>`;
  }
  return s;
};
/** A dashed ring round the portal, wider than its clear zone, so from far below it is out of sight. */
const ring = ([x, y], r, c = "#ffd166") => `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${c}" stroke-width="1.6" stroke-dasharray="4 5" opacity="0.9"/>`;
const sparkle = (x, y, r, c = "#ffffff") => `<path d="M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r}Z" fill="${c}"/>`;
const title = (t, sub, c = "#ffffff", cs = "#b8c4ff") => [[260, 175, t, 40, c], [264, 232, sub, 18, cs]];

/** A spiral galaxy of dots: arms, a bar and a core. Returns the SVG and a point on an arm (for "you are here"). */
function spiral({ cx, cy, scale, arms = 2, n = 600, tilt = 1, turn = 0, portal, clear, core = 1, hue = "blue" }) {
  const put = (r, a) => { const x = r * Math.cos(a), y = r * Math.sin(a) * tilt; return [cx + x * Math.cos(turn) - y * Math.sin(turn), cy + x * Math.sin(turn) + y * Math.cos(turn)]; };
  const outer = hue === "blue" ? ["#a2d2ff", "#cdb4db", "#ffffff", "#bde0fe"] : ["#ffc8dd", "#ffafcc", "#ffffff", "#cdb4db"];
  let b = "";
  for (let k = 0; k < arms; k++) {
    for (let i = 0; i < n; i++) {
      const t = (i / n) * 3.3 * Math.PI, base = scale * 0.055 * Math.exp(0.285 * t), spread = 0.1 + 0.12 * (i / n);
      const r = base * (1 + (rnd() - 0.5) * spread * 2), a = t + (k * 2 * Math.PI) / arms + (rnd() - 0.5) * spread * 2;
      const [x, y] = put(r, a);
      if (portal && Math.hypot(x - portal[0], y - portal[1]) < clear) continue;
      b += `<circle cx="${f(x)}" cy="${f(y)}" r="${f((0.5 + rnd() ** 3 * 2.2) * Math.max(0.5, scale / 500))}" fill="${r < scale * 0.18 ? pick(["#fff1c1", "#ffd6a5", "#ffffff"]) : pick(outer)}" opacity="${f(0.35 + rnd() * 0.65)}"/>`;
      if (r > scale * 0.2 && rnd() < 0.03) b += `<circle cx="${f(x)}" cy="${f(y)}" r="${f((4 + rnd() * 7) * scale / 500)}" fill="#ff8fab" opacity="0.22"/>`;
    }
  }
  const [ex, ey] = put(0, 0);
  if (core) b = `<ellipse cx="${f(ex)}" cy="${f(ey)}" rx="${f(scale * 0.42)}" ry="${f(scale * 0.42 * tilt)}" fill="url(#halo)" transform="rotate(${f((turn * 180) / Math.PI)} ${f(ex)} ${f(ey)})"/>` + b + `<ellipse cx="${f(ex)}" cy="${f(ey)}" rx="${f(scale * 0.16)}" ry="${f(scale * 0.1 * Math.max(tilt, 0.6))}" fill="url(#core)" transform="rotate(${f((turn * 180) / Math.PI)} ${f(ex)} ${f(ey)})"/>`;
  const arm = put(scale * 0.055 * Math.exp(0.285 * 1.9 * Math.PI), 1.9 * Math.PI);
  return { body: b, defs: radial("core", [[0, "#fffbe6"], [0.3, "#ffd6a5", 0.85], [1, "#ff7b00", 0]]) + radial("halo", [[0, "#9d4edd", 0.28], [1, "#9d4edd", 0]]), arm };
}

/** A web of filaments and clusters (galaxy clusters, or universes far below). */
function web(portal, clear, n = 46, dots = 7) {
  const nodes = [];
  while (nodes.length < n) { const x = 200 + rnd() * 1400, y = 130 + rnd() * 860; if (away(x, y, portal, clear * 3)) nodes.push([x, y]); }
  nodes.push([portal[0] + 46, portal[1] - 28], [portal[0] - 50, portal[1] + 24], [portal[0] + 20, portal[1] + 52]); // (a knot round the portal, its glows clear of it)
  let b = "";
  for (let i = 0; i < nodes.length; i++) {
    const near = nodes.map((m, j) => [Math.hypot(m[0] - nodes[i][0], m[1] - nodes[i][1]), j]).sort((a, c) => a[0] - c[0]).slice(1, 4);
    for (const [, j] of near) {
      if (j < i) continue;
      const [x1, y1] = nodes[i], [x2, y2] = nodes[j], m = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / dots);
      for (let s = 0; s < m; s++) {
        const u = rnd(), x = x1 + (x2 - x1) * u + (rnd() - 0.5) * 16, y = y1 + (y2 - y1) * u + (rnd() - 0.5) * 16;
        if (Math.hypot(x - portal[0], y - portal[1]) < clear) continue;
        b += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.5 + rnd() * 1.3)}" fill="${pick(["#9bb1ff", "#c77dff", "#7ae7ff", "#ffffff"])}" opacity="${f(0.25 + rnd() * 0.55)}"/>`;
      }
    }
  }
  for (const [x, y] of nodes) b += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(10 + rnd() * 20)}" fill="url(#cl)"/>`;
  return { body: b, defs: radial("cl", [[0, "#ffe5b4", 0.9], [0.3, "#ff9e7a", 0.4], [1, "#7b2ff7", 0]]) };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Out: the multiverse, the observable universe, the Local Group, the Milky Way, the Sun's neighbourhood, the heliosphere
export function multiverse() {
  const portal = [CX, CY];
  let defs = radial("bg", [[0, "#1b0f3a"], [0.6, "#0a0620"], [1, "#03020a"]]) + radial("ours", [[0, "#0b1238"], [0.8, "#070b26"], [1, "#2a3a8a"]]);
  let b = `<rect width="${W}" height="${H}" rx="48" fill="url(#bg)"/>` + stars(170, portal, 140);
  const hues = [["#00b4d8", "#03045e"], ["#f72585", "#3a0ca3"], ["#ffb703", "#9d0208"], ["#80ffdb", "#5390d9"], ["#c77dff", "#240046"]];
  for (let i = 0; i < 34; i++) {
    const x = 220 + rnd() * 1360, y = 140 + rnd() * 840, r = 18 + rnd() * 70;
    if (Math.hypot(x - CX, y - CY) < r + 120 || (x < 1000 && y < 320)) continue;
    const [a, c] = pick(hues), id = `u${i}`;
    defs += radial(id, [[0, c, 0.9], [0.7, a, 0.35], [0.97, a, 0.8], [1, a, 0]], 0.42, 0.4);
    b += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="url(#${id})"/>`;
  }
  b += `<circle cx="${CX}" cy="${CY}" r="80" fill="url(#ours)"/>` + ring(portal, 96);
  return {
    svg: svg(b, defs), portal,
    labels: [...title("The multiverse?", "A thousand zoom levels above the Solar System. Every bubble could be a universe."), [CX + 104, CY - 88, "Ours. 960 levels in.", 18, "#ffd166"]],
  };
}

export function observable() {
  const portal = [CX, CY], clear = 7;
  const w = web(portal, clear, 40, 14);
  const b = w.body + ring(portal, 26);
  return {
    svg: svg(b, w.defs), portal,
    labels: [...title("The observable universe", "Each glow is a cluster of thousands of galaxies, strung along filaments of dark matter."), [CX + 32, CY - 34, "Zoom in here", 16, "#ffd166"]],
  };
}

export function localGroup() {
  const portal = [CX, CY], clear = 40;
  const a = spiral({ cx: 1290, cy: 330, scale: 260, n: 170, tilt: 0.38, turn: -0.6, hue: "pink" });
  const t = spiral({ cx: 1420, cy: 820, scale: 110, n: 90, tilt: 0.7, turn: 0.8 });
  let b = a.body.replaceAll("url(#core)", "url(#coreA)").replaceAll("url(#halo)", "url(#haloA)") + t.body.replaceAll("url(#core)", "url(#coreT)").replaceAll("url(#halo)", "url(#haloT)");
  const defs = a.defs.replace('id="core"', 'id="coreA"').replace('id="halo"', 'id="haloA"') + t.defs.replace('id="core"', 'id="coreT"').replace('id="halo"', 'id="haloT"');
  for (const [x, y, r] of [[700, 690, 22], [760, 760, 13]]) { // the Magellanic Clouds
    for (let i = 0; i < 70; i++) b += `<circle cx="${f(x + (rnd() - 0.5) * r * 2)}" cy="${f(y + (rnd() - 0.5) * r * 1.3)}" r="${f(0.6 + rnd() * 1.2)}" fill="${pick(["#cfe3ff", "#ffffff", "#ffd6a5"])}" opacity="${f(0.4 + rnd() * 0.5)}"/>`;
  }
  for (let i = 0; i < 26; i++) { const x = 220 + rnd() * 1360, y = 140 + rnd() * 840; if (away(x, y, portal, clear * 2)) b += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(1.5 + rnd() * 3)}" fill="#cdb4db" opacity="0.5"/>`; }
  b = stars(110, portal, clear) + b + ring(portal, 58);
  return {
    svg: svg(b, defs), portal,
    labels: [...title("The Local Group", "About 80 galaxies, ten million light years across. The one in the middle is ours."), [1150, 520, "Andromeda", 16, "#ffc8dd"], [1370, 900, "Triangulum", 14, "#bde0fe"], [640, 790, "The Magellanic Clouds", 14, "#cfe3ff"], [CX + 62, CY - 60, "The Milky Way", 16, "#ffd166"]],
  };
}

export function milkyWay() {
  const sp = spiral({ cx: CX, cy: CY, scale: 1250, n: 620, arms: 2, tilt: 0.92, turn: 0.3, core: 1 });
  const portal = sp.arm.map((v) => Math.round(v));
  // (the spiral is drawn again without the dots that fall in the clear zone of the portal)
  seed = 101;
  const s2 = spiral({ cx: CX, cy: CY, scale: 1250, n: 620, arms: 2, tilt: 0.92, turn: 0.3, core: 1, portal, clear: 14 });
  const b = stars(120, portal, 5) + s2.body + ring(portal, 16);
  return {
    svg: svg(b, s2.defs), portal,
    labels: [...title("The Milky Way", "Some 400 billion stars. The Sun is on a quiet spur, two-thirds of the way out."), [portal[0] + 22, portal[1] - 24, "You are here", 16, "#ffd166"]],
  };
}

export function neighbourhood() {
  const portal = [CX, CY], clear = 5;
  const known = [
    ["Alpha Centauri", 1010, 640, 3.2, "#fff1c1"], ["Proxima Centauri", 1030, 668, 1.4, "#ff7b5c"], ["Barnard's Star", 760, 470, 1.4, "#ff7b5c"],
    ["Sirius", 1240, 330, 5, "#cfe3ff"], ["Wolf 359", 640, 650, 1.2, "#ff6b4a"], ["Lalande 21185", 1120, 470, 1.6, "#ffb38a"],
    ["Epsilon Eridani", 560, 380, 2.2, "#ffd6a5"], ["Procyon", 1360, 560, 3.6, "#fff7e0"], ["Tau Ceti", 480, 800, 2.2, "#fff1c1"],
    ["61 Cygni", 1180, 850, 1.8, "#ffb38a"], ["Altair", 700, 900, 3.4, "#e0ecff"], ["Luyten's Star", 1450, 720, 1.2, "#ff7b5c"],
  ];
  let defs = radial("glow", [[0, "#ffffff", 0.8], [0.3, "#ffffff", 0.25], [1, "#ffffff", 0]]);
  let b = stars(180, portal, clear * 4, { rmax: 1 });
  for (const [, x, y, r, c] of known) b += `<circle cx="${x}" cy="${y}" r="${r * 4}" fill="url(#glow)" opacity="0.5"/><circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>` + sparkle(x, y, r * 3, c);
  defs += radial("sunring", [[0, "#ffd166", 0], [0.3, "#ffd166", 0], [0.4, "#ffd166", 0.9], [1, "#fb8500", 0]]);
  b += `<circle cx="${CX}" cy="${CY}" r="8" fill="url(#sunring)"/>` + ring(portal, 20);
  for (const r of [175, 350]) b += `<circle cx="${CX}" cy="${CY}" r="${r}" fill="none" stroke="#9fb4ff" stroke-opacity="0.25" stroke-width="1" stroke-dasharray="2 8"/>`;
  return {
    svg: svg(b, defs), portal,
    labels: [...title("The Sun's neighbourhood", "Every star within 20 light years. Light from the nearest takes 4.2 years to reach us."),
      ...known.map(([n, x, y, r, c]) => [x + r + 8, y - 8, n, 12, c]), [CX + 26, CY - 30, "The Sun", 14, "#ffd166"], [CX + 352, CY - 8, "10 ly", 11, "#9fb4ff"]],
    pen: [[1010, 640], [1120, 470], [1240, 330], [1360, 560]], // a hand-drawn line between three stars
  };
}

export function heliosphere() {
  const portal = [CX, CY], clear = 2.5;
  let defs = radial("helio", [[0, "#0a1a4a", 0], [0.78, "#1b3b8f", 0.1], [0.95, "#48cae4", 0.45], [1, "#48cae4", 0]]);
  defs += linear("tail", [[0, "#48cae4", 0.25], [1, "#48cae4", 0]]);
  let b = stars(130, portal, 30);
  b += `<path d="M ${CX - 200} ${CY - 260} C ${CX - 600} ${CY - 240}, ${CX - 900} ${CY - 120}, ${CX - 1100} ${CY - 60} L ${CX - 1100} ${CY + 60} C ${CX - 900} ${CY + 120}, ${CX - 600} ${CY + 240}, ${CX - 200} ${CY + 260} Z" fill="url(#tail)"/>`;
  b += `<ellipse cx="${CX + 40}" cy="${CY}" rx="330" ry="300" fill="url(#helio)"/>`;
  b += `<circle cx="${CX}" cy="${CY}" r="180" fill="none" stroke="#90e0ef" stroke-opacity="0.5" stroke-width="1.5" stroke-dasharray="6 6"/>`;
  for (let i = 0; i < 300; i++) { const a = rnd() * Math.PI * 2, r = 38 + rnd() * 26; b += `<circle cx="${f(CX + r * Math.cos(a))}" cy="${f(CY + r * Math.sin(a) * 0.9)}" r="${f(0.4 + rnd() * 0.7)}" fill="#c9d6ff" opacity="${f(0.3 + rnd() * 0.5)}"/>`; }
  for (const [ang, len, name] of [[-0.5, 520, "Voyager 1"], [0.62, 440, "Voyager 2"]]) {
    const x = CX + len * Math.cos(ang), y = CY + len * Math.sin(ang);
    b += `<path d="M ${CX + 10} ${CY} Q ${CX + len * 0.6} ${CY + len * Math.sin(ang) * 0.3}, ${f(x)} ${f(y)}" fill="none" stroke="#ffd6a5" stroke-width="1.2" stroke-dasharray="2 6"/><path d="M ${f(x)} ${f(y - 6)} L ${f(x + 6)} ${f(y + 4)} L ${f(x - 6)} ${f(y + 4)} Z" fill="#ffd6a5"/>`;
  }
  b += `<path d="M ${CX + 360} ${CY + 200} q -40 30 -160 60" fill="none" stroke="#bde0fe" stroke-width="2" opacity="0.6" stroke-linecap="round"/><circle cx="${CX + 362}" cy="${CY + 199}" r="3" fill="#ffffff"/>`;
  defs += radial("sunring", [[0, "#ffd166", 0], [0.2, "#ffd166", 0], [0.3, "#ffd166", 0.9], [1, "#fb8500", 0]]);
  b += `<circle cx="${CX}" cy="${CY}" r="14" fill="url(#sunring)"/>` + ring(portal, 22);
  return {
    svg: svg(b, defs), portal,
    labels: [...title("The heliosphere", "The solar wind blows a bubble 240 times wider than Earth's orbit. Two probes have left it."),
      [CX + 300, CY - 300, "Voyager 1 (2012)", 13, "#ffd6a5"], [CX + 320, CY + 290, "Voyager 2 (2018)", 13, "#ffd6a5"], [CX + 20, CY + 180, "Termination shock", 12, "#90e0ef"], [CX - 140, CY - 64, "Kuiper belt", 12, "#c9d6ff"], [CX + 230, CY + 220, "A comet", 12, "#bde0fe"], [CX - 600, CY - 16, "The heliotail", 13, "#48cae4"]],
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Home: the Solar System, with the Sun in the middle
export const PLANETS = {
  Mercury: { rx: 120, t: 2.4, r: 4, c: ["#e0e0e0", "#6c6c6c"] },
  Venus: { rx: 175, t: 2.1, r: 7, c: ["#fff1c1", "#d08c34"] },
  Earth: { rx: 245, t: 0.95, r: 9, c: ["#8fe3ff", "#0b2f6b"] },
  Mars: { rx: 315, t: 3.5, r: 6, c: ["#ffb38a", "#9c2f1a"] },
  Jupiter: { rx: 450, t: -0.6, r: 30, c: ["#f3d9b1", "#8a5532"] },
  Saturn: { rx: 590, t: 2.75, r: 22, c: ["#f7e6b5", "#9b7a3d"] },
  Uranus: { rx: 670, t: 0.35, r: 13, c: ["#d7f9ff", "#4fb3bf"] },
  Neptune: { rx: 720, t: -0.5, r: 12, c: ["#a9c7ff", "#2541b2"] },
};
const orbit = (rx, t) => [CX + rx * Math.cos(t), CY + rx * 0.42 * Math.sin(t)];
for (const p of Object.values(PLANETS)) p.at = orbit(p.rx, p.t).map((v) => Math.round(v * 100) / 100);
export function solarSystem() {
  let defs = radial("sunglow", [[0, "#ffd166", 0.8], [0.35, "#fb8500", 0.3], [1, "#fb8500", 0]]) + radial("sun", [[0, "#fffbe6"], [0.35, "#ffd166"], [1, "#f77f00"]], 0.42, 0.4);
  defs += radial("neb1", [[0, "#7b2ff7", 0.35], [1, "#7b2ff7", 0]]) + radial("neb2", [[0, "#00b4d8", 0.25], [1, "#00b4d8", 0]]);
  const portal = PLANETS.Earth.at;
  let b = `<ellipse cx="1420" cy="250" rx="380" ry="200" fill="url(#neb1)"/><ellipse cx="420" cy="900" rx="420" ry="160" fill="url(#neb2)"/>`;
  b += stars(200, portal, 40);
  for (const [n, p] of Object.entries(PLANETS)) b += `<ellipse cx="${CX}" cy="${CY}" rx="${p.rx}" ry="${f(p.rx * 0.42)}" fill="none" stroke="#9fb4ff" stroke-opacity="${n === "Earth" ? 0.6 : 0.3}" stroke-width="1.1" stroke-dasharray="3 7"/>`;
  for (let i = 0; i < 260; i++) { const t = rnd() * Math.PI * 2, rx = 365 + rnd() * 45; const [x, y] = orbit(rx, t); if (away(x, y, portal, 40)) b += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.5 + rnd() * 0.9)}" fill="#c2b8a3" opacity="${f(0.4 + rnd() * 0.5)}"/>`; }
  b += `<circle cx="${CX}" cy="${CY}" r="190" fill="url(#sunglow)"/><circle id="Sun" cx="${CX}" cy="${CY}" r="64" fill="url(#sun)"/>`;
  for (const [n, p] of Object.entries(PLANETS)) {
    defs += radial(`p${n}`, [[0, p.c[0]], [1, p.c[1]]], 0.35, 0.35);
    b += `<circle id="${n}" cx="${p.at[0]}" cy="${p.at[1]}" r="${p.r}" fill="url(#p${n})"/>`;
  }
  const [jx, jy] = PLANETS.Jupiter.at;
  defs += linear("bands", [[0, "#000000", 0], [0.3, "#8a5532", 0.35], [0.45, "#000000", 0], [0.62, "#8a5532", 0.4], [0.75, "#000000", 0]], 0, 1);
  b += `<circle cx="${jx}" cy="${jy}" r="30" fill="url(#bands)"/><ellipse cx="${jx + 9}" cy="${jy + 8}" rx="5.5" ry="3.2" fill="#c0563b"/>`;
  b += ring(portal, 30, "#7ae7ff");
  const lab = Object.entries(PLANETS).filter(([n]) => n !== "Earth").map(([n, p]) => [p.at[0] - n.length * 3.4, p.at[1] + p.r + 8, n, 12, "#c9d6ff"]);
  return {
    svg: svg(b, defs), portal,
    labels: [[260, 190, "canvast", 64, "#ffffff"], [264, 276, "An endless canvas. Scroll in or out: there is no edge, in either direction.", 18, "#b8c4ff"], ...lab,
      [portal[0] + 26, portal[1] - 32, "Earth", 14, "#7ae7ff"], [264, 314, "Zoom out and the universe is 1,000 levels up. Zoom into Earth and it goes on forever.", 14, "#7ae7ff"]],
  };
}
export const saturnRing = () => svg(`<ellipse cx="${CX}" cy="${CY}" rx="52" ry="13" fill="#e9d8a6" opacity="0.92" transform="rotate(-14 ${CX} ${CY})"/><ellipse cx="${CX}" cy="${CY}" rx="35" ry="8" fill="#e9d8a6" transform="rotate(-14 ${CX} ${CY})"/>`);

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// In: Earth, an island, a tree, a leaf, its cells, DNA, an atom, its nucleus, a proton, the Planck length, and beyond
export const EARTH_R = 9 * 32; // Earth's radius at +5
export function earth() {
  const R = EARTH_R, portal = [CX - 70, CY + 40], clear = 9, g = ground("#1c1f5a", 1150);
  let defs = g.defs + radial("ocean", [[0, "#4fc3f7"], [0.55, "#1f77c9"], [1, "#082a5e"]], 0.36, 0.34) + radial("atmo", [[0, "#7fdcff", 0], [0.86, "#7fdcff", 0], [0.93, "#7fdcff", 0.55], [1, "#7fdcff", 0]]);
  defs += radial("night", [[0, "#000814", 0], [0.62, "#000814", 0], [1, "#000814", 0.75]], 0.3, 0.3) + `<clipPath id="disc"><circle cx="${CX}" cy="${CY}" r="${R}"/></clipPath>`;
  const blob = (x, y, s, rot, c) => `<path transform="translate(${x} ${y}) rotate(${rot}) scale(${s})" d="M0-40C22-46 46-30 52-6C58 18 38 26 30 44C22 62-4 70-20 52C-34 36-58 34-56 8C-54-18-24-34 0-40Z" fill="${c}"/>`;
  let inside = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="url(#ocean)"/>`;
  inside += blob(CX - 150, CY - 120, 1.9, 20, "#3a9d5d") + blob(CX + 120, CY - 70, 1.6, 70, "#5a9e48") + blob(CX + 150, CY + 140, 1.2, 10, "#c9a66b") + blob(CX - 190, CY + 170, 0.9, 45, "#2e8b57");
  inside += blob(CX + 30, CY - 250, 0.9, -10, "#e8eef2") + blob(CX - 10, CY + 270, 1.1, 0, "#f1f5f9");
  for (let i = 0; i < 16; i++) {
    const a = rnd() * Math.PI * 2, d = rnd() * R * 0.92, x = CX + d * Math.cos(a), y = CY + d * Math.sin(a);
    if (Math.hypot(x - portal[0], y - portal[1]) < 70) continue;
    inside += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(30 + rnd() * 60)}" ry="${f(6 + rnd() * 10)}" fill="#ffffff" opacity="${f(0.3 + rnd() * 0.4)}" transform="rotate(${f(-20 + rnd() * 40)} ${f(x)} ${f(y)})"/>`;
  }
  let b = g.body + stars(90, [CX, CY], R + 60) + `<circle cx="${CX}" cy="${CY}" r="${R + 36}" fill="url(#atmo)"/><g clip-path="url(#disc)">${inside}</g><circle cx="${CX}" cy="${CY}" r="${R}" fill="url(#night)"/>`;
  b += `<path d="M ${CX + 200} ${CY - 220} C ${CX + 320} ${CY - 420}, ${CX + 520} ${CY - 330}, ${CX + 460} ${CY - 170}" fill="none" stroke="#ffd6a5" stroke-width="2" stroke-dasharray="2 9" stroke-linecap="round"/>`;
  b += ring(portal, clear + 14, "#ffd166");
  void clear;
  return {
    svg: svg(b, defs), portal,
    labels: [...title("Earth", "32× closer than the Solar System. The rocket is a Union of five shapes, the Moon a Subtract."), [portal[0] + 26, portal[1] - 30, "An island", 14, "#ffd166"]],
    moonAt: [CX + 470, CY - 300], rocketAt: [CX + 460, CY - 120],
  };
}
export const moon = () => svg(`<defs>${radial("m", [[0, "#f4f1ea"], [1, "#9a958c"]], 0.35, 0.35)}</defs><circle cx="${CX}" cy="${CY}" r="62" fill="url(#m)"/><circle cx="${CX + 26}" cy="${CY - 16}" r="55" fill="#000"/>`);
export const rocketParts = () => svg(
  `<path d="M${CX} ${CY - 100} C ${CX + 32} ${CY - 66}, ${CX + 36} ${CY}, ${CX + 26} ${CY + 50} L ${CX - 26} ${CY + 50} C ${CX - 36} ${CY}, ${CX - 32} ${CY - 66}, ${CX} ${CY - 100} Z" fill="#f1f5f9"/>` +
  `<path d="M${CX - 24} ${CY + 8} L ${CX - 50} ${CY + 60} L ${CX - 22} ${CY + 50} Z" fill="#f1f5f9"/><path d="M${CX + 24} ${CY + 8} L ${CX + 50} ${CY + 60} L ${CX + 22} ${CY + 50} Z" fill="#f1f5f9"/>` +
  `<rect x="${CX - 16}" y="${CY + 46}" width="32" height="14" rx="3" fill="#f1f5f9"/>`);
export const rocketDetails = () => svg(
  `<defs>${linear("fl", [[0, "#fff3b0"], [0.5, "#ffb703"], [1, "#f72585", 0]], 0, 1)}${radial("gl", [[0, "#bde0fe"], [1, "#1d3557"]], 0.35, 0.35)}</defs>` +
  `<circle cx="${CX}" cy="${CY - 36}" r="14" fill="#e63946"/><circle cx="${CX}" cy="${CY - 36}" r="10" fill="url(#gl)"/><path d="M${CX - 14} ${CY + 60} Q${CX} ${CY + 112} ${CX + 14} ${CY + 60} Z" fill="url(#fl)"/>` +
  `<path d="M${CX} ${CY - 100} C ${CX + 10} ${CY - 90}, ${CX + 17} ${CY - 80}, ${CX + 21} ${CY - 70} L ${CX - 21} ${CY - 70} C ${CX - 17} ${CY - 80}, ${CX - 10} ${CY - 90}, ${CX} ${CY - 100} Z" fill="#e63946"/>`);

export function island() {
  const g = ground("#1c6fb5");
  const portal = [CX + 60, CY - 20], clear = 10;
  let defs = g.defs + radial("sand", [[0, "#f4e3b5"], [0.85, "#e9cf8f"], [1, "#e9cf8f", 0]]) + radial("lagoon", [[0, "#7fe3e3"], [1, "#2bb3c0", 0]]);
  const isl = (s) => `M ${CX - 380 * s} ${CY + 40 * s} C ${CX - 420 * s} ${CY - 180 * s}, ${CX - 120 * s} ${CY - 330 * s}, ${CX + 120 * s} ${CY - 270 * s} C ${CX + 380 * s} ${CY - 220 * s}, ${CX + 460 * s} ${CY + 20 * s}, ${CX + 300 * s} ${CY + 210 * s} C ${CX + 130 * s} ${CY + 400 * s}, ${CX - 300 * s} ${CY + 330 * s}, ${CX - 380 * s} ${CY + 40 * s} Z`;
  let b = g.body + `<ellipse cx="${CX}" cy="${CY}" rx="620" ry="470" fill="url(#lagoon)" opacity="0.7"/>`;
  b += `<path d="${isl(1.12)}" fill="#efd9a0"/><path d="${isl(1)}" fill="#4caf50"/><path d="${isl(0.7)}" fill="#3d9a47"/>`;
  for (let i = 0; i < 260; i++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 300, x = CX + d * Math.cos(a) * 1.1, y = CY + d * Math.sin(a) * 0.8;
    if (Math.hypot(x - portal[0], y - portal[1]) < clear * 3) continue;
    b += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(5 + rnd() * 9)}" fill="${pick(["#2d6a4f", "#40916c", "#1b4332", "#52b788"])}"/>`;
  }
  for (const [x, y, s] of [[CX - 520, CY - 260, 1], [CX + 560, CY + 300, 1.3]]) b += `<path d="M ${x} ${y} l ${30 * s} ${8 * s} l ${-30 * s} ${8 * s} z" fill="#ffffff"/><path d="M ${x - 4} ${y + 18 * s} l ${40 * s} 0 l ${-6 * s} ${8 * s} l ${-28 * s} 0 z" fill="#8b5e34"/>`;
  for (let i = 0; i < 40; i++) { const x = 200 + rnd() * 1400, y = 130 + rnd() * 860; if (Math.hypot((x - CX) / 1.4, y - CY) > 420) b += `<path d="M ${f(x)} ${f(y)} q 12 -6 24 0 q 12 6 24 0" fill="none" stroke="#bfe9ff" stroke-width="1.5" opacity="0.5"/>`; }
  b += `<circle cx="${portal[0]}" cy="${portal[1]}" r="${clear * 0.9}" fill="#6fbf5f"/>` + ring(portal, clear * 2.6, "#ffd166");
  return { svg: svg(b, defs), portal, labels: [...title("An island", "128× closer. Forest, reef and two boats. One tree stands alone in a clearing."), [portal[0] + 32, portal[1] - 34, "That tree", 14, "#ffd166"]] };
}

export function tree() {
  const g = ground("#6fbf5f");
  const portal = [CX - 40, CY + 30], clear = 17;
  let defs = g.defs + radial("crown", [[0, "#52b788"], [0.7, "#2d6a4f"], [1, "#1b4332"]], 0.4, 0.4) + radial("shadow", [[0, "#1b4332", 0.5], [1, "#1b4332", 0]]);
  let b = g.body + `<ellipse cx="${CX + 90}" cy="${CY + 70}" rx="460" ry="400" fill="url(#shadow)"/><circle cx="${CX}" cy="${CY}" r="420" fill="url(#crown)"/>`;
  for (let i = 0; i < 400; i++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 420, x = CX + d * Math.cos(a), y = CY + d * Math.sin(a);
    if (Math.hypot(x - portal[0], y - portal[1]) < clear * 2) continue;
    const r = 7 + rnd() * 9, ang = rnd() * 180;
    b += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(r)}" ry="${f(r * 0.5)}" fill="${pick(["#40916c", "#52b788", "#74c69d", "#2d6a4f", "#95d5b2"])}" transform="rotate(${f(ang)} ${f(x)} ${f(y)})"/>`;
  }
  for (let i = 0; i < 60; i++) { const x = 200 + rnd() * 1400, y = 130 + rnd() * 860; if (Math.hypot(x - CX, y - CY) > 470) b += `<path d="M ${f(x)} ${f(y)} l 2 -9 l 2 9" fill="none" stroke="#3d8b37" stroke-width="1.4"/>`; }
  for (const [x, y, c] of [[CX + 560, CY - 300, "#ffd6e0"], [CX - 600, CY + 320, "#fff3b0"], [CX + 620, CY + 340, "#e0c3fc"]]) for (let k = 0; k < 5; k++) b += `<circle cx="${f(x + 7 * Math.cos(k * 1.256))}" cy="${f(y + 7 * Math.sin(k * 1.256))}" r="5" fill="${c}"/>`;
  b += ring(portal, clear * 2.2, "#ffd166");
  return { svg: svg(b, defs), portal, labels: [...title("A tree, from above", "128× closer again. About 200,000 leaves. Pick one."), [portal[0] + 42, portal[1] - 44, "This leaf", 14, "#ffd166"]] };
}

export function leaf() {
  const g = ground("#2d6a4f");
  const portal = [CX + 120, CY - 60], clear = 9;
  let defs = g.defs + linear("blade", [[0, "#74c69d"], [0.5, "#52b788"], [1, "#2d6a4f"]], 1, 1);
  const outline = `M ${CX - 640} ${CY + 40} C ${CX - 420} ${CY - 380}, ${CX + 300} ${CY - 420}, ${CX + 640} ${CY - 40} C ${CX + 300} ${CY + 380}, ${CX - 420} ${CY + 420}, ${CX - 640} ${CY + 40} Z`;
  let b = g.body + `<path d="${outline}" fill="url(#blade)"/>`;
  b += `<path d="M ${CX - 700} ${CY + 46} Q ${CX} ${CY - 20} ${CX + 640} ${CY - 40}" fill="none" stroke="#d8f3dc" stroke-width="7" opacity="0.8"/>`;
  for (let i = -5; i <= 5; i++) if (i) { const x = CX + i * 105; b += `<path d="M ${x} ${f(CY - 6 - i * 4)} Q ${x + 90} ${CY - 120 * Math.sign(i) * 0 - 150} ${x + 170} ${CY - 260}" fill="none" stroke="#b7e4c7" stroke-width="2.4" opacity="0.6"/><path d="M ${x} ${f(CY - 6 - i * 4)} Q ${x + 90} ${CY + 150} ${x + 170} ${CY + 260}" fill="none" stroke="#b7e4c7" stroke-width="2.4" opacity="0.6"/>`; }
  for (let i = 0; i < 160; i++) {
    const x = CX - 520 + rnd() * 1040, y = CY - 250 + rnd() * 500;
    if (Math.hypot(x - portal[0], y - portal[1]) < clear * 3) continue;
    b += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="3.2" ry="2" fill="none" stroke="#1b4332" stroke-width="0.8" opacity="0.45"/>`;
  }
  b += `<circle cx="1500" cy="300" r="18" fill="#d4f1f9" opacity="0.6"/><circle cx="1494" cy="294" r="5" fill="#ffffff" opacity="0.8"/>`;
  b += ring(portal, clear * 2.4, "#ffd166");
  return { svg: svg(b, defs), portal, labels: [...title("A leaf", "64× closer. Veins, pores (stomata) and a drop of dew. Its skin is made of cells."), [portal[0] + 30, portal[1] - 32, "A cell", 14, "#ffd166"]] };
}

export function cells() {
  const g = ground("#95d5b2");
  const portal = [CX + 30, CY + 10], clear = 10;
  let defs = g.defs + radial("nuc", [[0, "#9d4edd"], [0.8, "#7b2cbf"], [1, "#5a189a"]], 0.4, 0.4);
  let b = g.body;
  const cw = 330, ch = 230;
  for (let row = -3; row <= 3; row++) for (let col = -3; col <= 3; col++) {
    const x = CX + col * cw + (row % 2 ? cw / 2 : 0) - cw / 2, y = CY + row * ch - ch / 2;
    const centre = row === 0 && col === 0;
    b += `<rect x="${x + 6}" y="${y + 6}" width="${cw - 12}" height="${ch - 12}" rx="38" fill="${centre ? "#b7e4c7" : "#a7dcb9"}" stroke="#2d6a4f" stroke-width="5"/>`;
    for (let k = 0; k < 9; k++) {
      const px = x + 40 + rnd() * (cw - 80), py = y + 34 + rnd() * (ch - 68);
      if (centre && Math.hypot(px - portal[0], py - portal[1]) < 80) continue;
      b += `<ellipse cx="${f(px)}" cy="${f(py)}" rx="15" ry="9" fill="#2d9a4f" transform="rotate(${f(rnd() * 180)} ${f(px)} ${f(py)})"/>`;
    }
    if (!centre) b += `<circle cx="${f(x + cw * 0.3 + rnd() * cw * 0.4)}" cy="${f(y + ch * 0.35 + rnd() * ch * 0.3)}" r="26" fill="url(#nuc)" opacity="0.85"/>`;
  }
  b += `<circle cx="${portal[0]}" cy="${portal[1]}" r="62" fill="url(#nuc)"/><circle cx="${portal[0] + 26}" cy="${portal[1] - 24}" r="12" fill="#5a189a"/>`;
  b += ring(portal, 74, "#ffd166");
  void clear;
  return { svg: svg(b, defs), portal, labels: [...title("Plant cells", "128× closer. Walls, green chloroplasts and in each cell a nucleus that holds the DNA.", "#081c15", "#1b4332"), [portal[0] + 78, portal[1] - 70, "The nucleus", 14, "#5a189a"]] };
}

export function dna() {
  const g = ground("#9d4edd");
  const portal = [CX, CY], clear = 4.5;
  let defs = g.defs;
  let b = g.body;
  for (let i = 0; i < 90; i++) { const x = 180 + rnd() * 1440, y = 112 + rnd() * 900; if (Math.hypot(x - CX, y - CY) > 60) b += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(2 + rnd() * 4)}" fill="#c77dff" opacity="0.35"/>`; }
  const amp = 120, period = 520, steps = 34, x0 = -40, x1 = 1840;
  const yA = (x) => CY + amp * Math.sin(((x - CX) / period) * 2 * Math.PI), yB = (x) => CY - amp * Math.sin(((x - CX) / period) * 2 * Math.PI);
  const pairs = [["#ffd166", "#06d6a0"], ["#ef476f", "#118ab2"]];
  for (let k = 0; k < steps; k++) {
    const x = x0 + ((x1 - x0) * (k + 0.5)) / steps, a = yA(x), c = yB(x), [ca, cb] = pick(pairs), m = (a + c) / 2;
    if (Math.abs(x - portal[0]) < 30) continue;
    b += `<line x1="${f(x)}" y1="${f(a)}" x2="${f(x)}" y2="${f(m)}" stroke="${ca}" stroke-width="9" stroke-linecap="round"/><line x1="${f(x)}" y1="${f(m)}" x2="${f(x)}" y2="${f(c)}" stroke="${cb}" stroke-width="9" stroke-linecap="round"/>`;
  }
  const path = (fy) => { let d = ""; for (let x = x0; x <= x1; x += 10) d += `${d ? "L" : "M"} ${x} ${f(fy(x))} `; return d; };
  b += `<path d="${path(yA)}" fill="none" stroke="#e0aaff" stroke-width="12" stroke-linecap="round"/><path d="${path(yB)}" fill="none" stroke="#f1c0e8" stroke-width="12" stroke-linecap="round" opacity="0.9"/>`;
  b += ring(portal, 13, "#ffd166");
  void clear;
  return { svg: svg(b, defs), portal, labels: [...title("DNA", "256× closer. Two strands and their base pairs. Between them, one carbon atom."), [portal[0] + 20, portal[1] - 26, "A carbon atom", 14, "#ffd166"]] };
}

export function atom() {
  const g = ground("#120c2e");
  const portal = [CX, CY], clear = 9;
  let defs = g.defs + radial("cloud", [[0, "#4cc9f0", 0.0], [0.25, "#4cc9f0", 0.18], [0.7, "#4361ee", 0.12], [1, "#4361ee", 0]]);
  let b = g.body + `<circle cx="${CX}" cy="${CY}" r="420" fill="url(#cloud)"/>`;
  for (const [rx, ry, rot] of [[400, 120, 0], [400, 120, 60], [400, 120, -60], [190, 190, 0]]) b += `<ellipse cx="${CX}" cy="${CY}" rx="${rx}" ry="${ry}" fill="none" stroke="#90e0ef" stroke-width="1.6" opacity="0.55" transform="rotate(${rot} ${CX} ${CY})"/>`;
  for (const [rx, ry, rot, t] of [[400, 120, 0, 0.4], [400, 120, 60, 2.2], [400, 120, -60, 4.1], [400, 120, 0, 3.5], [190, 190, 0, 1.2], [190, 190, 0, 4.3]]) {
    const r = (rot * Math.PI) / 180, x = rx * Math.cos(t), y = ry * Math.sin(t);
    b += `<circle cx="${f(CX + x * Math.cos(r) - y * Math.sin(r))}" cy="${f(CY + x * Math.sin(r) + y * Math.cos(r))}" r="9" fill="#7ae7ff"/>`;
  }
  b += ring(portal, clear * 2.6, "#ffd166");
  return { svg: svg(b, defs), portal, labels: [...title("A carbon atom", "128× closer. Six electrons in their clouds. The nucleus is 100,000 times smaller than the atom."), [portal[0] + 28, portal[1] - 32, "The nucleus", 14, "#ffd166"]] };
}

export function nucleus() {
  const g = ground("#0b0820");
  const portal = [CX + 70, CY - 40];
  let defs = g.defs + radial("p", [[0, "#ffb3c1"], [0.6, "#ef476f"], [1, "#9d0208"]], 0.35, 0.35) + radial("n", [[0, "#e9ecef"], [0.6, "#8d99ae"], [1, "#2b2d42"]], 0.35, 0.35) + radial("glowN", [[0, "#ffd166", 0.35], [1, "#ffd166", 0]]);
  let b = g.body + `<circle cx="${CX}" cy="${CY}" r="320" fill="url(#glowN)"/>`;
  const balls = [[-70, 40, "n"], [0, 80, "p"], [-110, -40, "p"], [-20, -10, "n"], [60, 50, "n"], [-60, -110, "n"], [20, -110, "p"], [110, 20, "p"], [-130, 60, "n"], [40, -40, "n"], [-40, 120, "p"]];
  for (const [dx, dy, k] of balls) b += `<circle cx="${CX + dx}" cy="${CY + dy}" r="58" fill="url(#${k})"/>`;
  b += `<circle cx="${portal[0]}" cy="${portal[1]}" r="58" fill="url(#p)"/>` + ring(portal, 74, "#ffd166");
  return { svg: svg(b, defs), portal, labels: [...title("The nucleus", "128× closer. Six protons (red) and six neutrons (grey)."), [portal[0] + 80, portal[1] - 70, "A proton", 14, "#ffd166"]] };
}

export function proton() {
  const g = ground("#ef476f");
  const portal = [CX, CY + 30];
  let defs = g.defs + radial("pr", [[0, "#ff8fa3", 0.5], [1, "#c9184a", 0]]) + radial("qr", [[0, "#ffccd5"], [1, "#d00000"]], 0.35, 0.35) + radial("qg", [[0, "#d8f3dc"], [1, "#2d6a4f"]], 0.35, 0.35) + radial("qb", [[0, "#caf0f8"], [1, "#0077b6"]], 0.35, 0.35);
  let b = g.body + `<circle cx="${CX}" cy="${CY}" r="480" fill="url(#pr)"/>`;
  const q = [[CX - 230, CY - 150, "qr", "u"], [CX + 240, CY - 120, "qg", "u"], [CX, CY + 240, "qb", "d"]];
  const spring = ([x1, y1], [x2, y2]) => { const n = 18, dx = (x2 - x1) / n, dy = (y2 - y1) / n, L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L; let d = `M ${x1} ${y1}`; for (let i = 1; i <= n; i++) { const s = i % 2 ? 22 : -22; d += ` Q ${f(x1 + dx * (i - 0.5) + nx * s)} ${f(y1 + dy * (i - 0.5) + ny * s)} ${f(x1 + dx * i)} ${f(y1 + dy * i)}`; } return d; };
  for (let i = 0; i < 3; i++) b += `<path d="${spring(q[i], q[(i + 1) % 3])}" fill="none" stroke="#ffd166" stroke-width="4" opacity="0.8"/>`;
  for (const [x, y, id] of q) b += `<circle cx="${x}" cy="${y}" r="64" fill="url(#${id})"/>`;
  b += ring(portal, 26, "#ffffff");
  return {
    svg: svg(b, defs), portal,
    labels: [...title("Inside a proton", "64× closer. Two up quarks and a down quark, bound by gluons."), [CX - 250, CY - 250, "up", 18, "#ffffff"], [CX + 225, CY - 220, "up", 18, "#ffffff"], [CX - 30, CY + 340, "down", 18, "#ffffff"], [portal[0] + 30, portal[1] - 40, "56 levels down: the smallest length physics knows", 14, "#ffffff"]],
  };
}

export function planck() {
  const g = ground("#10002b");
  const portal = [CX, CY];
  let defs = g.defs;
  let b = g.body;
  for (let i = 0; i < 300; i++) {
    const x = 180 + rnd() * 1440, y = 112 + rnd() * 900, r = 4 + rnd() ** 2 * 60;
    if (Math.hypot(x - CX, y - CY) < r + 26) continue;
    b += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="none" stroke="${pick(["#c77dff", "#7b2cbf", "#e0aaff", "#5a189a"])}" stroke-width="${f(1 + rnd() * 2)}" opacity="${f(0.25 + rnd() * 0.5)}"/>`;
  }
  b += ring(portal, 20, "#ffd166");
  return { svg: svg(b, defs), portal, labels: [...title("The Planck length", "1.6 × 10⁻³⁵ m: physics has no smaller ruler. A drawing app should stop here. canvast does not.", "#ffffff", "#e0aaff"), [portal[0] + 24, portal[1] - 28, "Keep going: 884 more levels", 14, "#ffd166"]] };
}

export function universeAgain() {
  const g = ground("#05071a");
  const portal = [CX, CY];
  const w = web(portal, 10, 36, 16);
  const b = g.body + w.body + ring(portal, 30, "#ffd166");
  return { svg: svg(b, g.defs + w.defs), portal, labels: [...title("Universes all the way down", "1,000 zoom levels below the Solar System: 10³⁰¹ times magnified, and still exact."), [portal[0] + 34, portal[1] - 36, "A million levels down: in here", 14, "#ffd166"]] };
}

export function million() {
  const g = ground("#0b0f2a");
  let defs = g.defs + radial("halo1", [[0, "#ffd166", 0.4], [1, "#ffd166", 0]]);
  let b = g.body + stars(140, null, 0) + `<circle cx="${CX}" cy="${CY + 40}" r="220" fill="url(#halo1)"/>`;
  b += `<path d="M ${CX} ${CY - 60} C ${CX + 40} ${CY - 120}, ${CX + 130} ${CY - 90}, ${CX + 120} ${CY - 10} C ${CX + 110} ${CY + 60}, ${CX + 30} ${CY + 100}, ${CX} ${CY + 140} C ${CX - 30} ${CY + 100}, ${CX - 110} ${CY + 60}, ${CX - 120} ${CY - 10} C ${CX - 130} ${CY - 90}, ${CX - 40} ${CY - 120}, ${CX} ${CY - 60} Z" fill="#ef476f"/>`;
  return { svg: svg(b, defs), portal: [CX, CY], labels: [...title("One million zoom levels", "10^301,030 × magnified. Every point here is stored exactly. Draw, write, undo: it all still works."), [CX - 200, CY + 200, "There is no bottom. (One jump goes 2^50 levels; press it again.)", 16, "#ffd166"]] };
}
