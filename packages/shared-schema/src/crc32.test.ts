import { describe, expect, it } from "vitest";
import { computeCrc32 } from "./crc32.js";

describe("computeCrc32", () => {
  it("matches the IEEE 802.3 check value for ASCII 123456789", () => {
    const bytes = new TextEncoder().encode("123456789");
    expect(computeCrc32(bytes)).toBe(0xcbf43926);
  });

  it("returns a stable unsigned value for an empty buffer", () => {
    expect(computeCrc32(new Uint8Array())).toBe(0x00000000);
  });
});
