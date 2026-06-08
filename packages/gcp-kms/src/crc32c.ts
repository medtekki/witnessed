/**
 * CRC32C (Castagnoli) — used for Cloud KMS request/response integrity checks.
 * Reflected algorithm, polynomial 0x1EDC6F41 (reflected form 0x82F63B78),
 * init 0xFFFFFFFF, final XOR 0xFFFFFFFF. Known vector: crc32c("123456789") === 0xE3069283.
 */
const POLY = 0x82f63b78;

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? POLY ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32c(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ TABLE[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}
