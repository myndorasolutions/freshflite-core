import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";

/** DER SubjectPublicKeyInfo prefix for a 32-byte Ed25519 public key. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function privateKeyFromPkcs8(pkcs8: Uint8Array): KeyObject {
  return createPrivateKey({ key: Buffer.from(pkcs8), format: "der", type: "pkcs8" });
}

export function publicKeyFromRaw(raw: Uint8Array): KeyObject {
  if (raw.byteLength !== 32) {
    throw new Error(`Ed25519 public key must be 32 bytes, received ${String(raw.byteLength)}`);
  }
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(raw)]),
    format: "der",
    type: "spki",
  });
}
