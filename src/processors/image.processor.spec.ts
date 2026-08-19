import { Test } from '@nestjs/testing';
import sharp from 'sharp';
import { StorageService } from '../storage/storage.service';
import {
  ImageProcessor,
  MEDIUM_MAX_WIDTH,
  PREVIEW_MAX_WIDTH,
} from './image.processor';

describe('ImageProcessor', () => {
  let processor: ImageProcessor;
  let storage: { headObject: jest.Mock; upload: jest.Mock };
  let original: Buffer;

  beforeAll(async () => {
    original = await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 3,
        background: { r: 200, g: 100, b: 50 },
      },
    })
      .jpeg()
      .toBuffer();
  });

  beforeEach(async () => {
    storage = {
      headObject: jest.fn().mockResolvedValue({ exists: false }),
      upload: jest.fn().mockResolvedValue('https://cdn.example/key'),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ImageProcessor,
        {
          provide: StorageService,
          useValue: {
            ...storage,
            buildKey: (userId: string, fileId: string, variant: string) =>
              `users/${userId}/photos/${fileId}/${variant}`,
          },
        },
      ],
    }).compile();

    processor = moduleRef.get(ImageProcessor);
  });

  it('generates medium and preview derivatives and uploads them', async () => {
    const result = await processor.process({
      userId: 'user-1',
      fileId: 'file-1',
      original,
      mimeType: 'image/jpeg',
    });

    expect(result.mediumKey).toBe('users/user-1/photos/file-1/medium');
    expect(result.previewKey).toBe('users/user-1/photos/file-1/preview');
    expect(result.width).toBe(400);
    expect(result.height).toBe(300);

    expect(storage.upload).toHaveBeenCalledWith(
      'users/user-1/photos/file-1/medium',
      expect.any(Buffer),
      'image/webp',
    );
    expect(storage.upload).toHaveBeenCalledWith(
      'users/user-1/photos/file-1/preview',
      expect.any(Buffer),
      'image/webp',
    );

    const medium = storage.upload.mock.calls[0][1] as Buffer;
    const preview = storage.upload.mock.calls[1][1] as Buffer;
    const mediumMeta = await sharp(medium).metadata();
    const previewMeta = await sharp(preview).metadata();

    expect(mediumMeta.width).toBeLessThanOrEqual(MEDIUM_MAX_WIDTH);
    expect(previewMeta.width).toBeLessThanOrEqual(PREVIEW_MAX_WIDTH);
    expect(mediumMeta.format).toBe('webp');
    expect(previewMeta.format).toBe('webp');
  });

  it('never enlarges a smaller image', async () => {
    const result = await processor.process({
      userId: 'user-1',
      fileId: 'file-1',
      original,
      mimeType: 'image/jpeg',
    });

    const medium = storage.upload.mock.calls[0][1] as Buffer;
    const mediumMeta = await sharp(medium).metadata();

    expect(result.width).toBe(400);
    expect(mediumMeta.width).toBe(400);
  });

  it('preserves the original untouched', async () => {
    const before = original.length;
    await processor.process({
      userId: 'user-1',
      fileId: 'file-1',
      original,
      mimeType: 'image/jpeg',
    });
    expect(original.length).toBe(before);
  });

  it('skips regeneration when derivatives already exist', async () => {
    storage.headObject.mockResolvedValue({ exists: true });
    const result = await processor.process({
      userId: 'user-1',
      fileId: 'file-1',
      original,
      mimeType: 'image/jpeg',
    });

    expect(storage.upload).not.toHaveBeenCalled();
    expect(result.mediumKey).toBe('users/user-1/photos/file-1/medium');
    expect(result.previewKey).toBe('users/user-1/photos/file-1/preview');
  });
});