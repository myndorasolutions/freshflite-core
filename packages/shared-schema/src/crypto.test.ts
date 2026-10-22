import { describe, expect, it } from "vitest";
import {
  canonicalSummaryBytes,
  generatePodKeyPair,
  publicKeyFromRawBase64,
  signManifestSummary,
  verifyManifestSignature,
} from "./crypto.js";

const summary = {
  flightNumber: "QI-0412",
  manifestId: "FF-MAN-QI0412-20261014",
  recordCount: 95,
  thermalIntegrityScorePct: 100,
};

describe("Ed25519 manifest seal", () => {
  it("verifies a signature and rejects a mutated summary", async () => {
    const keys = await generatePodKeyPair();
    const bytes = canonicalSummaryBytes(summary);
    const signature = await signManifestSummary(keys.privateKey, bytes);

    const restored = publicKeyFromRawBase64(keys.publicKeyBase64);
    expect(await verifyManifestSignature(restored, bytes, signature)).toBe(true);

    const tampered = canonicalSummaryBytes({ ...summary, recordCount: 94 });
    expect(await verifyManifestSignature(restored, tampered, signature)).toBe(false);
  });

  it("canonicalizes object key order", () => {
    const left = canonicalSummaryBytes({ b: 1, a: 2 });
    const right = canonicalSummaryBytes({ a: 2, b: 1 });
    expect(Buffer.from(left).equals(Buffer.from(right))).toBe(true);
  });
});
