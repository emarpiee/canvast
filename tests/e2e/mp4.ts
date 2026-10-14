/** A file with the boxes of an MP4 video (size, length, codec) and garbage for the pictures: no browser decodes it, but its shape can be read. */
export function makeFakeMp4(w: number, h: number, seconds: number, codec = "hvc1", turned = false): Buffer {
  const u32 = (n: number): Buffer => Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
  const box = (type: string, ...parts: Buffer[]): Buffer => {
    const body = Buffer.concat(parts);
    return Buffer.concat([u32(8 + body.length), Buffer.from(type), body]);
  };
  const zeros = (n: number): Buffer => Buffer.alloc(n);
  const mvhd = box("mvhd", zeros(4), zeros(8), u32(1000), u32(seconds * 1000), zeros(80));
  const matrix = Buffer.concat([u32(turned ? 0 : 0x10000), u32(turned ? 0x10000 : 0), zeros(4), u32(turned ? 0xffff0000 : 0), u32(turned ? 0 : 0x10000), zeros(4), zeros(8), u32(0x40000000)]);
  const tkhd = box("tkhd", zeros(4), zeros(8), u32(1), zeros(4), u32(seconds * 1000), zeros(8), zeros(8), matrix, u32(w * 65536), u32(h * 65536));
  const hdlr = box("hdlr", zeros(8), Buffer.from("vide"), zeros(12), Buffer.from("v\0"));
  const stsd = box("stsd", zeros(4), u32(1), box(codec, zeros(78)));
  const trak = box("trak", tkhd, box("mdia", hdlr, box("minf", box("stbl", stsd))));
  return Buffer.concat([box("ftyp", Buffer.from("isom"), zeros(4), Buffer.from("isom")), box("moov", mvhd, trak), box("mdat", Buffer.from("not really video data"))]);
}
