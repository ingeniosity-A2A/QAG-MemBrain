import { SignatureRecord } from "./signatureRecord.js";

export function assertSignatureRecordShape(signatureRecord: SignatureRecord): void {
  assertNonEmptyString(signatureRecord.signatureId, "signatureId");
  assertNonEmptyString(signatureRecord.signature, "signature");
  assertNonEmptyString(signatureRecord.signedAt, "signedAt");
  assertNonEmptyString(signatureRecord.signerId, "signerId");

  if (typeof signatureRecord.authorityId !== "undefined") {
    assertNonEmptyString(signatureRecord.authorityId, "authorityId");
  }
  assertNonEmptyString(signatureRecord.artifactHash, "artifactHash");

  if (typeof signatureRecord.publicKey !== "undefined") {
    assertNonEmptyString(signatureRecord.publicKey, "publicKey");
  }

  if (signatureRecord.algorithm !== "ed25519") {
    throw new Error("Signature record requires algorithm to be ed25519");
  }
}

function assertNonEmptyString(value: string, field: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Signature record requires ${field}`);
  }
}
