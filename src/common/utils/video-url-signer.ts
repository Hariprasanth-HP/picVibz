import { createHmac } from 'crypto';

export type VideoUrlType = 'video' | 'poster' | 'preview';

export interface VideoUrlSignerConfig {
  baseUrl: string;
  secret: string;
  defaultExpirySeconds?: number;
}

export class VideoUrlSigner {
  private readonly baseUrl: string;
  private readonly secret: string;
  private readonly defaultExpirySeconds: number;

  constructor(config: VideoUrlSignerConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.secret = config.secret;
    this.defaultExpirySeconds = config.defaultExpirySeconds ?? 300;
  }

  sign(originalKey: string, type: VideoUrlType, expiresInSeconds?: number): string {
    const expires = Math.floor(Date.now() / 1000) + (expiresInSeconds ?? this.defaultExpirySeconds);
    const message = `${originalKey}\n${type}\n${expires}`;
    const signature = createHmac('sha256', this.secret).update(message).digest('base64url');
    const params = new URLSearchParams({
      key: originalKey,
      size: type,
      exp: String(expires),
      sig: signature,
    });
    return `${this.baseUrl}/video/${type === 'video' ? '' : type}?${params.toString()}`.replace(
      '/video/',
      '/video/',
    );
  }

  signAll(
    originalKey: string,
    options?: {
      videoKey?: string | null;
      posterKey?: string | null;
      previewKey?: string | null;
      expiresInSeconds?: number;
    },
  ): {
    videoUrl: string | null;
    posterUrl: string | null;
    previewUrl: string | null;
  } {
    const expiry = options?.expiresInSeconds ?? this.defaultExpirySeconds;
    return {
      videoUrl: options?.videoKey ? this.sign(originalKey, 'video', expiry) : null,
      posterUrl: options?.posterKey ? this.sign(originalKey, 'poster', expiry) : null,
      previewUrl: options?.previewKey ? this.sign(originalKey, 'preview', expiry) : null,
    };
  }
}

export function createVideoUrlSigner(config: VideoUrlSignerConfig): VideoUrlSigner {
  return new VideoUrlSigner(config);
}
