// SPDX-License-Identifier: AGPL-3.0-or-later
// UUIDv7 ids, made on the device (RFC 9562): 48-bit Unix ms time, version 7,
// variant 10, then random bits. The time prefix keeps ids in creation order.

type RandomFill = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;

const defaultFill: RandomFill = (b) => crypto.getRandomValues(b);

export function uuidv7(nowMs: number = Date.now(), fill: RandomFill = defaultFill): string {
  const b = fill(new Uint8Array(16));
  let t = nowMs;
  for (let i = 5; i >= 0; i--) {
    b[i] = t & 0xff;
    t = Math.floor(t / 256);
  }
  b[6] = ((b[6] as number) & 0x0f) | 0x70;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
