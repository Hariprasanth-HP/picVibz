import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { StorageService } from '../storage/storage.service';
import type { MediaProcessInput, MediaProcessResult } from './media-process.types';

export const MEDIUM_MAX_WIDTH = 1600;
export const MEDIUM_WEBP_QUALITY = 80;
export const PREVIEW_MAX_WIDTH = 300;
export const PREVIEW_WEBP_QUALITY = 75;

@Injectable()
export class ImageProcessor {
  private readonly logger = new Logger(ImageProcessor.name);

  constructor(private readonly storage: StorageService) {}

  async process(input: MediaProcessInput): Promise<MediaProcessResult> {
    const { userId, fileId, original } = input;

    const metadata = await sharp(original).metadata();
    const width = metadata.width ?? null;
    const height = metadata.height ?? null;

    const mediumKey = this.storage.buildKey(userId, fileId, 'medium');
    const previewKey = this.storage.buildKey(userId, fileId, 'preview');

    const [mediumHead, previewHead] = await Promise.all([
      this.storage.headObject(mediumKey),
      this.storage.headObject(previewKey),
    ]);

    if (mediumHead.exists && previewHead.exists) {
      this.logger.log(
        `Derivatives already exist, skipping fileId=${fileId} medium=${mediumKey} preview=${previewKey}`,
      );
      return { mediumKey, previewKey, width, height, duration: null };
    }

    const [medium, preview] = await Promise.all([
      sharp(original)
        .rotate()
        .resize({ width: MEDIUM_MAX_WIDTH, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: MEDIUM_WEBP_QUALITY })
        .toBuffer(),
      sharp(original)
        .rotate()
        .resize({ width: PREVIEW_MAX_WIDTH, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: PREVIEW_WEBP_QUALITY })
        .toBuffer(),
    ]);

    await Promise.all([
      this.storage.upload(mediumKey, medium, 'image/webp'),
      this.storage.upload(previewKey, preview, 'image/webp'),
    ]);

    this.logger.log(
      `Processed image fileId=${fileId} width=${width} height=${height} medium=${mediumKey} preview=${previewKey}`,
    );

    return { mediumKey, previewKey, width, height, duration: null };
  }
}
