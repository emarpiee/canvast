/**
 * The picture of an MP4/MOV video at a time, decoded with WebCodecs from the file's own samples. It does not go through a
 * `<video>` element: some browsers (Firefox on Android) play the element but draw nothing for it into a canvas. H.264 and
 * H.265 only; whatever the browser's decoders do not take throws.
 */
import { boxes } from "./mp4-probe";
import type { Box } from "./mp4-probe";

interface Sample {
  off: number;
  size: number;
  cts: number;
  key: boolean;
}

interface Track {
  timescale: number;
  samples: Sample[]; // decode order
  codec: string;
  description: Uint8Array;
  w: number;
  h: number;
  /** Quarter turns clockwise the display applies (0 to 3). */
  turns: number;
  duration: number;
  /** Media time (timescale units) shown at 0. */
  editStart: number;
}

const type4 = (b: Uint8Array, p: number): string => String.fromCharCode(b[p]!, b[p + 1]!, b[p + 2]!, b[p + 3]!);
const hex = (n: number, w = 2): string => n.toString(16).padStart(w, "0");

function reverseBits32(n: number): number {
  let r = 0;
  for (let i = 0; i < 32; i++) r = (r * 2 + ((n >>> i) & 1)) >>> 0;
  return r;
}

/** The codec string and the decoder's description box of a sample entry (avc1/avc3 or hvc1/hev1), or null. */
function codecOf(b: Uint8Array, entry: Box): { codec: string; description: Uint8Array } | null {
  const kind = type4(b, entry.start - 4); // the entry's own type sits just before its payload
  // A visual sample entry: 6 reserved + 2 index + 16 predefined + 4 size + 50 more bytes before its child boxes.
  const kids = boxes(b, entry.start + 78, entry.end);
  if (kind === "avc1" || kind === "avc3") {
    const c = kids.find((k) => k.type === "avcC");
    if (!c) return null;
    const d = b.subarray(c.start, c.end);
    return { codec: `${kind}.${hex(d[1]!)}${hex(d[2]!)}${hex(d[3]!)}`, description: d };
  }
  if (kind === "hvc1" || kind === "hev1") {
    const c = kids.find((k) => k.type === "hvcC");
    if (!c) return null;
    const d = b.subarray(c.start, c.end);
    const space = ["", "A", "B", "C"][d[1]! >> 6]!;
    const compat = new DataView(d.buffer, d.byteOffset).getUint32(2);
    const cons = [...d.subarray(6, 12)];
    while (cons.length > 1 && cons[cons.length - 1] === 0) cons.pop();
    return { codec: `${kind}.${space}${d[1]! & 31}.${reverseBits32(compat).toString(16)}.${d[1]! & 32 ? "H" : "L"}${d[12]}.${cons.map((x) => hex(x)).join(".")}`, description: d };
  }
  return null;
}

function parseTrack(b: Uint8Array): Track | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const moov = boxes(b, 0, b.length).find((x) => x.type === "moov");
  if (!moov) return null;
  for (const trak of boxes(b, moov.start, moov.end).filter((x) => x.type === "trak")) {
    const t: Partial<Track> & { stts?: number[]; ctts?: number[]; stsz?: number[]; stsc?: number[]; stco?: number[]; stss?: number[] } = {};
    let video = false;
    const walk = (from: number, to: number): void => {
      for (const x of boxes(b, from, to)) {
        if (["mdia", "minf", "stbl", "edts"].includes(x.type)) walk(x.start, x.end);
        else if (x.type === "tkhd") {
          const v1 = b[x.start] === 1;
          const m = x.start + (v1 ? 48 : 40);
          const [a, bb, c, d] = [dv.getInt32(m), dv.getInt32(m + 4), dv.getInt32(m + 12), dv.getInt32(m + 16)];
          t.turns = a === 0 && bb > 0 && c < 0 && d === 0 ? 1 : a < 0 && d < 0 ? 2 : a === 0 && bb < 0 && c > 0 && d === 0 ? 3 : 0;
        } else if (x.type === "elst") {
          // The first edit that plays media says which media time is shown at 0 (B-frame files start a frame or two in).
          const v1 = b[x.start] === 1;
          const n = dv.getUint32(x.start + 4);
          for (let i = 0; i < n; i++) {
            const e = x.start + 8 + i * (v1 ? 20 : 12);
            const mt = v1 ? Number(dv.getBigInt64(e + 8)) : dv.getInt32(e + 4);
            if (mt >= 0) {
              t.editStart = mt;
              break;
            }
          }
        } else if (x.type === "mdhd") {
          const v1 = b[x.start] === 1;
          t.timescale = dv.getUint32(x.start + (v1 ? 20 : 12));
          t.duration = (v1 ? Number(dv.getBigUint64(x.start + 24)) : dv.getUint32(x.start + 16)) / t.timescale;
        } else if (x.type === "hdlr") video = type4(b, x.start + 8) === "vide";
        else if (x.type === "stsd") {
          const entry = boxes(b, x.start + 8, x.end)[0];
          if (entry) {
            const c = codecOf(b, entry);
            if (c) Object.assign(t, c);
            t.w = dv.getUint16(entry.start + 24);
            t.h = dv.getUint16(entry.start + 26);
          }
        } else if (x.type === "stts" || x.type === "ctts" || x.type === "stsc") {
          const n = dv.getUint32(x.start + 4);
          const out: number[] = [];
          const per = x.type === "stsc" ? 3 : 2;
          for (let i = 0; i < n * per; i++) out.push(x.type === "ctts" && i % 2 === 1 ? dv.getInt32(x.start + 8 + i * 4) : dv.getUint32(x.start + 8 + i * 4));
          t[x.type] = out;
        } else if (x.type === "stsz") {
          const fixed = dv.getUint32(x.start + 4);
          const n = dv.getUint32(x.start + 8);
          t.stsz = fixed ? new Array<number>(n).fill(fixed) : Array.from({ length: n }, (_, i) => dv.getUint32(x.start + 12 + i * 4));
        } else if (x.type === "stco" || x.type === "co64") {
          const n = dv.getUint32(x.start + 4);
          t.stco = Array.from({ length: n }, (_, i) => (x.type === "co64" ? Number(dv.getBigUint64(x.start + 8 + i * 8)) : dv.getUint32(x.start + 8 + i * 4)));
        } else if (x.type === "stss") {
          const n = dv.getUint32(x.start + 4);
          t.stss = Array.from({ length: n }, (_, i) => dv.getUint32(x.start + 8 + i * 4));
        }
      }
    };
    walk(trak.start, trak.end);
    if (!video) continue;
    if (!t.codec || !t.description || !t.timescale || !t.stsz || !t.stco || !t.stsc || !t.stts || !t.w || !t.h) return null;
    // Sample sizes -> offsets (chunks of samples), times (stts decode time + ctts offset), keyframes (stss; none listed = all).
    const n = t.stsz.length;
    const samples: Sample[] = new Array<Sample>(n);
    let s = 0;
    for (let c = 0; c < t.stco.length && s < n; c++) {
      let per = 0;
      for (let i = 0; i < t.stsc.length; i += 3) if (t.stsc[i]! <= c + 1) per = t.stsc[i + 1]!;
      let off = t.stco[c]!;
      for (let k = 0; k < per && s < n; k++, s++) {
        samples[s] = { off, size: t.stsz[s]!, cts: 0, key: !t.stss };
        off += t.stsz[s]!;
      }
    }
    let dts = 0;
    let i = 0;
    for (let e = 0; e < t.stts.length; e += 2) for (let k = 0; k < t.stts[e]! && i < n; k++, i++) {
      samples[i]!.cts = dts;
      dts += t.stts[e + 1]!;
    }
    if (t.ctts) {
      i = 0;
      for (let e = 0; e < t.ctts.length; e += 2) for (let k = 0; k < t.ctts[e]! && i < n; k++, i++) samples[i]!.cts += t.ctts[e + 1]!;
    }
    if (t.stss) for (const k of t.stss) if (samples[k - 1]) samples[k - 1]!.key = true;
    if (samples.some((x) => !x)) return null;
    return { timescale: t.timescale, samples, codec: t.codec, description: t.description, w: t.w, h: t.h, turns: t.turns ?? 0, duration: t.duration ?? 0, editStart: t.editStart ?? 0 };
  }
  return null;
}

/** How many samples after the wanted one are fed before flushing: pictures can come out of the decoder after later samples (B-frames). */
const LOOKAHEAD = 24;

/** The picture at `t` seconds (clamped to the file) and the video's length. Throws when this browser cannot decode the file this way. */
export async function decodeMp4Frame(blob: Blob, t: number): Promise<{ bitmap: ImageBitmap; duration: number }> {
  const VD = (globalThis as { VideoDecoder?: typeof VideoDecoder }).VideoDecoder;
  if (!VD) throw new Error("no WebCodecs");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const tr = parseTrack(bytes);
  if (!tr) throw new Error("not an MP4 this decoder reads");
  const config: VideoDecoderConfig = { codec: tr.codec, description: tr.description, codedWidth: tr.w, codedHeight: tr.h };
  if (!(await VD.isConfigSupported(config)).supported) throw new Error(`WebCodecs cannot decode ${tr.codec}`);
  // The sample shown at t: the last one (in presentation order) whose time is not after it.
  const want = Math.max(0, Math.min(t, tr.duration)) * tr.timescale + tr.editStart;
  let target = 0;
  for (let i = 0; i < tr.samples.length; i++) if (tr.samples[i]!.cts <= want && tr.samples[i]!.cts >= tr.samples[target]!.cts) target = i;
  let start = target;
  while (start > 0 && !tr.samples[start]!.key) start--;
  const stamp = tr.samples[target]!.cts;
  const us = (cts: number): number => Math.round((cts / tr.timescale) * 1e6);
  let frame: VideoFrame | null = null;
  let failure: unknown = null;
  const dec = new VD({
    output: (f) => {
      if (f.timestamp === us(stamp) && !frame) frame = f;
      else f.close();
    },
    error: (e) => (failure = e),
  });
  try {
    dec.configure(config);
    // Pictures of earlier samples than the target can still be waiting in the decoder: feed some past it, then flush.
    for (let i = start; i < Math.min(tr.samples.length, target + LOOKAHEAD); i++) {
      const s = tr.samples[i]!;
      dec.decode(new EncodedVideoChunk({ type: s.key ? "key" : "delta", timestamp: us(s.cts), data: bytes.subarray(s.off, s.off + s.size) }));
    }
    await dec.flush();
  } finally {
    if (dec.state !== "closed") dec.close();
  }
  const f = frame as VideoFrame | null;
  if (!f) throw failure instanceof Error ? failure : new Error("the decoder gave no picture");
  try {
    // The display turns the picture by the track's matrix; the decoder's pictures are as stored.
    const swap = tr.turns % 2 === 1;
    const c = document.createElement("canvas");
    c.width = swap ? f.displayHeight : f.displayWidth;
    c.height = swap ? f.displayWidth : f.displayHeight;
    const x = c.getContext("2d")!;
    x.translate(c.width / 2, c.height / 2);
    x.rotate((tr.turns * Math.PI) / 2);
    x.drawImage(f, -f.displayWidth / 2, -f.displayHeight / 2);
    return { bitmap: await createImageBitmap(c), duration: tr.duration };
  } finally {
    f.close();
  }
}
