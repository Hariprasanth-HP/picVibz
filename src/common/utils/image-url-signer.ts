import { createHmac } from 'crypto';

export type ImageSize = 'original' | 'medium' | 'preview';

export interface ImageUrlSignerConfig {
  baseUrl: string;
  secret: string;
  defaultExpirySeconds?: number;
}

export class ImageUrlSigner {
  private readonly baseUrl: string;
  private readonly secret: string;
  private readonly defaultExpirySeconds: number;

  constructor(config: ImageUrlSignerConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.secret = config.secret;
    this.defaultExpirySeconds = config.defaultExpirySeconds ?? 300;
  }

  sign(key: string, size: ImageSize, expiresInSeconds?: number): string {
    const expires = Math.floor(Date.now() / 1000) + (expiresInSeconds ?? this.defaultExpirySeconds);
    const message = `${key}\n${size}\n${expires}`;
    const signature = createHmac('sha256', this.secret).update(message).digest('base64url');
    const params = new URLSearchParams({
      key,
      size,
      exp: String(expires),
      sig: signature,
    });
    return `${this.baseUrl}/image?${params.toString()}`;
  }

  signAll(
    originalKey: string,
    options?: { mediumKey?: string | null; previewKey?: string | null; expiresInSeconds?: number },
  ): {
    originalUrl: string;
    mediumUrl: string | null;
    previewUrl: string | null;
    thumbnailUrl: string | null;
  } {
    const expiry = options?.expiresInSeconds ?? this.defaultExpirySeconds;
    return {
      originalUrl: this.sign(originalKey, 'original', expiry),
      mediumUrl: options?.mediumKey ? this.sign(options.mediumKey, 'medium', expiry) : null,
      previewUrl: options?.previewKey ? this.sign(options.previewKey, 'preview', expiry) : null,
      thumbnailUrl: options?.mediumKey ? this.sign(options.mediumKey, 'medium', expiry) : null,
    };
  }
}

export function createImageUrlSigner(config: ImageUrlSignerConfig): ImageUrlSigner {
  return new ImageUrlSigner(config);
}
