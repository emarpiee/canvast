/**
 * A self-signed TLS certificate for the sharing server (ADR 0184), made with Node's own crypto: an EC P-256 key and an X.509 v3
 * certificate written in DER by hand (a few ASN.1 shapes; no dependency). Its SHA-256 fingerprint is what a guest compares or pins.
 */
import { createHash, createPublicKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";

const len = (n: number): Buffer => (n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 0xff]));
const tlv = (tag: number, ...body: Buffer[]): Buffer => {
  const b = Buffer.concat(body);
  return Buffer.concat([Buffer.from([tag]), len(b.length), b]);
};
const seq = (...b: Buffer[]): Buffer => tlv(0x30, ...b);
const oid = (dotted: string): Buffer => {
  const [a, b, ...rest] = dotted.split(".").map(Number);
  const out = [a! * 40 + b!];
  for (const n of rest) {
    const bytes = [n & 0x7f];
    for (let v = n >> 7; v > 0; v >>= 7) bytes.unshift((v & 0x7f) | 0x80);
    out.push(...bytes);
  }
  return tlv(0x06, Buffer.from(out));
};
const utc = (d: Date): Buffer => tlv(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, "").slice(2, 14) + "Z", "ascii"));

const ECDSA_SHA256 = "1.2.840.10045.4.3.2";

export interface SelfCert {
  /** PEM, for `https.createServer`. */
  key: string;
  cert: string;
  /** SHA-256 of the certificate's DER, upper-case hex pairs joined by colons (as browsers show it). */
  fingerprint: string;
}

/** A new certificate for `name` (its common name), valid from a day ago for `years`, for `localhost` and the given addresses. */
export function makeSelfCert(name = "canvast", years = 10, ips: readonly string[] = []): SelfCert {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spki = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  const cn = seq(tlv(0x31, seq(oid("2.5.4.3"), tlv(0x0c, Buffer.from(name, "utf8")))));
  const serial = randomBytes(16);
  serial[0]! &= 0x7f; // (positive)
  const from = new Date(Date.now() - 86_400_000);
  const until = new Date(from.getTime() + years * 365.25 * 86_400_000);
  const ipBytes = ips.flatMap((ip) => (/^\d+\.\d+\.\d+\.\d+$/.test(ip) ? [Buffer.from(ip.split(".").map(Number))] : []));
  const san = seq(oid("2.5.29.17"), tlv(0x04, seq(tlv(0x82, Buffer.from("localhost")), ...ipBytes.map((b) => tlv(0x87, b)))));
  const tbs = seq(
    tlv(0xa0, tlv(0x02, Buffer.from([2]))), // v3
    tlv(0x02, serial),
    seq(oid(ECDSA_SHA256)),
    cn,
    seq(utc(from), utc(until)),
    cn,
    spki,
    tlv(0xa3, seq(san)),
  );
  const der = seq(tbs, seq(oid(ECDSA_SHA256)), tlv(0x03, Buffer.from([0]), sign("sha256", tbs, privateKey)));
  const pem = (label: string, b: Buffer): string => `-----BEGIN ${label}-----\n${b.toString("base64").replace(/.{64}/g, "$&\n").replace(/\n?$/, "\n")}-----END ${label}-----\n`;
  return {
    key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    cert: pem("CERTIFICATE", der),
    fingerprint: fingerprintOf(der),
  };
}

/** A certificate's fingerprint from its DER bytes. */
export const fingerprintOf = (der: Uint8Array): string => createHash("sha256").update(der).digest("hex").toUpperCase().match(/../g)!.join(":");
