import {
  canonicalSummaryBytes,
  publicKeyFromRawBase64,
  verifyManifestSignature,
  type ManifestSealSummary,
} from "@freshflite/shared-schema";

export async function describeSealAudit(input: {
  publicKey: string;
  signature: string;
  summary: ManifestSealSummary;
  breached: boolean;
}): Promise<{ verified: boolean; message: string }> {
  const key = publicKeyFromRawBase64(input.publicKey);
  const verified = await verifyManifestSignature(key, canonicalSummaryBytes(input.summary), input.signature);
  if (!verified) {
    return { verified: false, message: "Ed25519 signature rejected." };
  }
  if (input.breached) {
    return {
      verified: true,
      message: "Signature valid. Sealed record includes the lid breach and thermal excursion.",
    };
  }
  return {
    verified: true,
    message: "Immutable Record Verified — Zero Post-Harvest Tampering",
  };
}
