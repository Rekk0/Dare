export interface SignedUpload {
  url: string;
  key: string;
  expiresAt: Date;
  headers?: Record<string, string>;
}

export interface StoragePort {
  signUpload(key: string, mime: string, ttlMs: number): Promise<SignedUpload>;
  signDownload(key: string, ttlMs: number): Promise<string>;
  delete(key: string): Promise<void>;
}
