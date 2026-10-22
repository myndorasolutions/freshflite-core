/** Portable Ed25519 seal. WebCrypto only, so the same module runs in Node, browsers, and Cloudflare Pages. */

export interface PodKeyPair {
  /** Raw 32-byte Ed25519 public key. */
  publicKey: Uint8Array;
  /** PKCS#8 DER for the Ed25519 private key. */
  privateKey: Uint8Array;
  /** Raw 32-byte Ed25519 public key, standard base64. */
  publicKeyBase64: string;
}

const ED25519: Algorithm = { name: "Ed25519" };

function subtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new Error("WebCrypto Ed25519 is not available in this runtime");
  }
  return subtle;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    const code = binary.charCodeAt(index);
    bytes[index] = code;
  }
  return bytes;
}

function asArrayBuffer(exported: ArrayBuffer | JsonWebKey): ArrayBuffer {
  if (!(exported instanceof ArrayBuffer)) {
    throw new Error("Ed25519 key export was not raw binary");
  }
  return exported;
}

function copyBuffer(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

async function importPrivateKey(privateKey: Uint8Array): Promise<CryptoKey> {
  return subtleCrypto().importKey("pkcs8", copyBuffer(privateKey), ED25519, false, ["sign"]);
}

async function importPublicKey(publicKey: Uint8Array): Promise<CryptoKey> {
  if (publicKey.byteLength !== 32) {
    throw new Error(`Ed25519 public key must be 32 bytes, received ${String(publicKey.byteLength)}`);
  }
  return subtleCrypto().importKey("raw", copyBuffer(publicKey), ED25519, true, ["verify"]);
}

/** Generate a pod signing key. The private key never leaves the caller. */
export async function generatePodKeyPair(): Promise<PodKeyPair> {
  const generated = await subtleCrypto().generateKey(ED25519, true, ["sign", "verify"]);
  if (!("privateKey" in generated)) {
    throw new Error("Ed25519 generateKey did not return a key pair");
  }
  const publicRaw = new Uint8Array(asArrayBuffer(await subtleCrypto().exportKey("raw", generated.publicKey)));
  const privatePkcs8 = new Uint8Array(asArrayBuffer(await subtleCrypto().exportKey("pkcs8", generated.privateKey)));
  if (publicRaw.byteLength !== 32) {
    throw new Error("Ed25519 public key export was not 32 bytes");
  }
  return {
    publicKey: publicRaw,
    privateKey: privatePkcs8,
    publicKeyBase64: bytesToBase64(publicRaw),
  };
}

/** Decode the raw 32-byte public key stored on a FreshTrace certificate. */
export function publicKeyFromRawBase64(publicKeyBase64: string): Uint8Array {
  const raw = base64ToBytes(publicKeyBase64);
  if (raw.byteLength !== 32) {
    throw new Error(`Ed25519 public key must be 32 bytes, received ${String(raw.byteLength)}`);
  }
  return raw;
}

function canonicalJson(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value).filter((entry) => entry[1] !== undefined);
    entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    const body = entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",");
    return `{${body}}`;
  }
  throw new TypeError(`Cannot canonicalize summary value of type ${typeof value}`);
}

/** UTF-8 canonical JSON. Key order does not change the signed bytes. */
export function canonicalSummaryBytes(summary: object): Uint8Array {
  return new TextEncoder().encode(canonicalJson(summary));
}

/** Ed25519 signature over the canonical summary, standard base64. */
export async function signManifestSummary(privateKey: Uint8Array, summary: Uint8Array): Promise<string> {
  const key = await importPrivateKey(privateKey);
  const signature = await subtleCrypto().sign(ED25519, key, copyBuffer(summary));
  return bytesToBase64(new Uint8Array(signature));
}

/** Return true only when the signature matches the summary under this public key. */
export async function verifyManifestSignature(
  publicKey: Uint8Array,
  summary: Uint8Array,
  signatureBase64: string,
): Promise<boolean> {
  try {
    const signature = base64ToBytes(signatureBase64);
    if (signature.byteLength !== 64) {
      return false;
    }
    const key = await importPublicKey(publicKey);
    return await subtleCrypto().verify(ED25519, key, copyBuffer(signature), copyBuffer(summary));
  } catch {
    return false;
  }
}
