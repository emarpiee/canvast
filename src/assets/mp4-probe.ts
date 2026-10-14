/**
 * What an MP4/MOV file says about its video without decoding it (ADR 0045): size, length and codec, read from the
 * `moov` boxes. It lets a video this browser cannot decode (say H.265 in Chrome on Linux) still be imported and shown
 * as a card of the right shape, to be played elsewhere. Anything unexpected gives null.
 */
export interface VideoProbe {
  w: number;
  h: number;
  /** Seconds (0 when the file does not say). */
  duration: number;
  /** Readable codec name, or the file's four-letter code. */
  codec: string;
}

const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl"]);
const CODECS: Record<string, string> = { avc1: "H.264", avc3: "H.264", hvc1: "H.265", hev1: "H.265", av01: "AV1", vp09: "VP9", vp08: "VP8", mp4v: "MPEG-4" };

interface Box {
  type: string;
  start: number;
  end: number;
}

function boxes(b: Uint8Array, from: number, to: number): Box[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Box[] = [];
  let p = from;
  while (p + 8 <= to) {
    let size = dv.getUint32(p);
    const type = String.fromCharCode(b[p + 4]!, b[p + 5]!, b[p + 6]!, b[p + 7]!);
    let head = 8;
    if (size === 1) {
      size = Number(dv.getBigUint64(p + 8));
      head = 16;
    } else if (size === 0) size = to - p;
    if (size < head || p + size > to) break;
    out.push({ type, start: p + head, end: p + size });
    p += size;
  }
  return out;
}

export function probeMp4(b: Uint8Array): VideoProbe | null {
  try {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const moov = boxes(b, 0, b.length).find((x) => x.type === "moov");
    if (!moov) return null;
    let timescale = 0;
    let movieDuration = 0;
    for (const x of boxes(b, moov.start, moov.end)) {
      if (x.type === "mvhd") {
        const v1 = b[x.start] === 1;
        timescale = dv.getUint32(x.start + (v1 ? 20 : 12));
        movieDuration = v1 ? Number(dv.getBigUint64(x.start + 24)) : dv.getUint32(x.start + 16);
      }
    }
    for (const trak of boxes(b, moov.start, moov.end).filter((x) => x.type === "trak")) {
      let w = 0;
      let h = 0;
      let swap = false;
      let video = false;
      let codec = "";
      const walk = (from: number, to: number): void => {
        for (const x of boxes(b, from, to)) {
          if (CONTAINERS.has(x.type)) walk(x.start, x.end);
          else if (x.type === "tkhd") {
            const o = x.start + (b[x.start] === 1 ? 88 : 76);
            w = dv.getUint32(o) / 65536;
            h = dv.getUint32(o + 4) / 65536;
            const m = x.start + (b[x.start] === 1 ? 48 : 40); // matrix a, b: a turn of 90 or 270 degrees swaps the sides
            swap = dv.getInt32(m) === 0 && dv.getInt32(m + 4) !== 0;
          } else if (x.type === "hdlr") video = String.fromCharCode(b[x.start + 8]!, b[x.start + 9]!, b[x.start + 10]!, b[x.start + 11]!) === "vide";
          else if (x.type === "stsd") {
            const f = String.fromCharCode(b[x.start + 12]!, b[x.start + 13]!, b[x.start + 14]!, b[x.start + 15]!);
            codec = CODECS[f] ?? f;
          }
        }
      };
      walk(trak.start, trak.end);
      if (video && w >= 1 && h >= 1) return { w: Math.round(swap ? h : w), h: Math.round(swap ? w : h), duration: timescale ? movieDuration / timescale : 0, codec };
    }
    return null;
  } catch {
    return null;
  }
}
