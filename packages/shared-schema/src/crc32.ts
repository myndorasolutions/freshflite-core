/**
 * IEEE 802.3 / ISO 3309 CRC-32 (reflected).
 * Polynomial 0xEDB88320, init 0xFFFFFFFF, xorout 0xFFFFFFFF.
 * The Ethernet check value of ASCII "123456789" is 0xCBF43926.
 */
const CRC32_POLY = 0xedb88320;

const CRC32_TABLE: Readonly<Uint32Array> = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      if ((crc & 1) === 1) {
        crc = (crc >>> 1) ^ CRC32_POLY;
      } else {
        crc >>>= 1;
      }
    }
    table[index] = crc >>> 0;
  }
  return table;
})();

/** CRC32 over `bytes`. The result is an unsigned 32-bit integer. */
export function computeCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index] ?? 0;
    const tableIndex = (crc ^ byte) & 0xff;
    const entry = CRC32_TABLE[tableIndex] ?? 0;
    crc = (entry ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
