import * as crypto from 'crypto';

export interface SignedEntry {
  seq: number;
  ts: string;
  layer: number;
  type: string;
  payload: unknown;
  hash: string;
  signature: string;
  signerPubKey: string;
}

export class TashiSigner {
  private privateKey: crypto.KeyObject;
  private publicKey: crypto.KeyObject;
  private publicKeyDer: string;

  constructor(pemKey?: string) {
    if (pemKey) {
      this.privateKey = crypto.createPrivateKey(pemKey);
    } else {
      const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
      this.privateKey = privateKey;
      this.publicKey = publicKey;
    }
    this.publicKey = crypto.createPublicKey(this.privateKey);
    this.publicKeyDer = this.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  }

  sign(hash: string): string {
    const sig = crypto.sign(null, Buffer.from(hash, 'utf-8'), this.privateKey);
    return sig.toString('base64');
  }

  verify(hash: string, signature: string, pubKeyDer?: string): boolean {
    const key = pubKeyDer
      ? crypto.createPublicKey({ key: Buffer.from(pubKeyDer, 'base64'), type: 'spki', format: 'der' })
      : this.publicKey;
    return crypto.verify(null, Buffer.from(hash, 'utf-8'), key, Buffer.from(signature, 'base64'));
  }

  get pubKeyDer(): string { return this.publicKeyDer; }

  exportPrivateKeyPem(): string {
    return this.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString('utf-8');
  }
}
