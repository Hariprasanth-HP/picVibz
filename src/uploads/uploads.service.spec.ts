import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { UploadsService } from './uploads.service';
import { ImageUrlSigner } from '../common/utils/image-url-signer';
import { VideoUrlSigner } from '../common/utils/video-url-signer';
import { VideoQueueService } from '../queues/video.queue';

describe('UploadsService', () => {
  let service: UploadsService;
  const prisma = {
    media: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    event: {
      findFirst: jest.fn(),
    },
  };
  const storage = {
    buildKey: jest.fn(),
    createPresignedPutUrl: jest.fn(),
    headObject: jest.fn(),
  };
  const urlSigner = {
    signAll: jest.fn(),
  };
  const videoSigner = {
    signAll: jest.fn(),
  };
  const videoQueue = {
    enqueueVideoProcessing: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    storage.buildKey.mockImplementation(
      (userId: string, fileId: string, variant: string) =>
        `users/${userId}/photos/${fileId}/${variant}`,
    );
    storage.createPresignedPutUrl.mockResolvedValue('https://signed.put/url');
    urlSigner.signAll.mockReturnValue({
      originalUrl:
        'https://worker.dev/image?key=users%2Fuser-1%2Fphotos%2Ffile-1%2Foriginal&size=original&exp=1234567890&sig=abc',
      mediumUrl:
        'https://worker.dev/image?key=users%2Fuser-1%2Fphotos%2Ffile-1%2Foriginal&size=medium&exp=1234567890&sig=def',
      previewUrl:
        'https://worker.dev/image?key=users%2Fuser-1%2Fphotos%2Ffile-1%2Foriginal&size=preview&exp=1234567890&sig=ghi',
      thumbnailUrl:
        'https://worker.dev/image?key=users%2Fuser-1%2Fphotos%2Ffile-1%2Foriginal&size=medium&exp=1234567890&sig=ghi',
    });
    videoSigner.signAll.mockReturnValue({
      videoUrl:
        'https://worker.dev/video?key=users%2Fuser-1%2Fphotos%2Ffile-1%2Foriginal&size=video&exp=1234567890&sig=abc',
      posterUrl: null,
      previewUrl: null,
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        UploadsService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, def?: string) => {
              const defaults: Record<string, string> = {
                UPLOAD_MAX_SIZE: '1048576000',
                SIGNED_URL_EXPIRATION: '300',
                IMAGE_WORKER_URL: 'https://worker.dev',
                IMAGE_SIGNING_SECRET: 'test-secret-key-32-chars-minimum-length',
                VIDEO_WORKER_URL: 'https://worker.dev',
                VIDEO_SIGNING_SECRET: 'test-secret-key-32-chars-minimum-length',
              };
              return defaults[key] ?? def;
            }),
            getOrThrow: jest.fn((key: string) => {
              const defaults: Record<string, string> = {
                UPLOAD_MAX_SIZE: '1048576000',
                SIGNED_URL_EXPIRATION: '300',
              };
              return defaults[key];
            }),
          },
        },
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: ImageUrlSigner, useValue: urlSigner },
        { provide: VideoUrlSigner, useValue: videoSigner },
        { provide: VideoQueueService, useValue: videoQueue },
      ],
    }).compile();

    service = moduleRef.get(UploadsService);
  });

  describe('init', () => {
    it('creates an UPLOADING media record and returns a signed PUT URL', async () => {
      const created = {
        id: 'file-1',
        type: 'PHOTO',
        uploadedBy: 'user-1',
        originalName: 'IMG_1234.jpg',
        mimetype: 'image/jpeg',
        size: BigInt(4829382),
        status: 'UPLOADING',
        originalKey: 'users/user-1/photos/file-1/original',
      };
      prisma.media.create.mockResolvedValue(created);

      const result = await service.init('user-1', {
        fileName: 'IMG_1234.jpg',
        mimeType: 'image/jpeg',
        size: 4829382,
      });

      expect(prisma.media.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'PHOTO',
          uploadedBy: 'user-1',
          status: 'UPLOADING',
          originalKey: expect.stringContaining('users/user-1/photos/') as unknown as string,
        }),
      });
      expect(storage.createPresignedPutUrl).toHaveBeenCalledWith(
        expect.stringContaining('users/user-1/photos/') as unknown as string,
        'image/jpeg',
        expect.any(Number),
      );
      expect(result).toEqual(
        expect.objectContaining({
          uploadId: 'file-1',
          storageKey: expect.stringContaining('users/user-1/photos/') as unknown as string,
          status: 'UPLOADING',
          uploadUrl: 'https://signed.put/url',
        }),
      );
    });

    it('rejects an unsupported mime type', async () => {
      await expect(
        service.init('user-1', {
          fileName: 'a.exe',
          mimeType: 'application/x-msdownload',
          size: 100,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.media.create).not.toHaveBeenCalled();
    });

    it('rejects a file larger than UPLOAD_MAX_SIZE', async () => {
      await expect(
        service.init('user-1', {
          fileName: 'big.mp4',
          mimeType: 'video/mp4',
          size: Number.MAX_SAFE_INTEGER,
        }),
      ).rejects.toThrow(PayloadTooLargeException);
      expect(prisma.media.create).not.toHaveBeenCalled();
    });

    it('stores eventId when the event belongs to the user', async () => {
      prisma.event.findFirst.mockResolvedValue({
        id: 'event-1',
        createdBy: 'user-1',
      });
      prisma.media.create.mockResolvedValue({
        id: 'file-1',
        type: 'PHOTO',
        uploadedBy: 'user-1',
        eventId: 'event-1',
        status: 'UPLOADING',
        originalKey: 'users/user-1/photos/file-1/original',
      });

      await service.init('user-1', {
        fileName: 'IMG_1234.jpg',
        mimeType: 'image/jpeg',
        size: 4829382,
        eventId: 'event-1',
      });

      expect(prisma.event.findFirst).toHaveBeenCalledWith({
        where: { id: 'event-1', createdBy: 'user-1' },
      });
      expect(prisma.media.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ eventId: 'event-1' }),
      });
    });

    it('rejects an eventId the user does not own', async () => {
      prisma.event.findFirst.mockResolvedValue(null);

      await expect(
        service.init('user-1', {
          fileName: 'IMG_1234.jpg',
          mimeType: 'image/jpeg',
          size: 4829382,
          eventId: 'event-other',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.media.create).not.toHaveBeenCalled();
    });
  });

  describe('complete', () => {
    it('returns 404 when the upload belongs to another user', async () => {
      prisma.media.findUnique.mockResolvedValue({
        id: 'file-1',
        uploadedBy: 'user-B',
        status: 'UPLOADING',
        originalKey: 'users/user-B/photos/file-1/original',
        mimetype: 'image/jpeg',
      });

      await expect(service.complete('user-A', 'file-1')).rejects.toThrow(NotFoundException);
      expect(prisma.media.update).not.toHaveBeenCalled();
    });

    it('verifies object exists in storage and marks READY (image)', async () => {
      prisma.media.findUnique.mockResolvedValue({
        id: 'file-1',
        uploadedBy: 'user-1',
        status: 'UPLOADING',
        originalKey: 'users/user-1/photos/file-1/original',
        mimetype: 'image/jpeg',
      });
      storage.headObject.mockResolvedValue({ exists: true, size: 100, contentType: 'image/jpeg' });

      const result = await service.complete('user-1', 'file-1');

      expect(storage.headObject).toHaveBeenCalledWith('users/user-1/photos/file-1/original');
      expect(prisma.media.update).toHaveBeenCalledWith({
        where: { id: 'file-1' },
        data: { status: 'READY' },
      });
      expect(result).toEqual({ id: 'file-1', status: 'READY' });
    });

    it('sets PROCESSING and enqueues the video for processing', async () => {
      prisma.media.findUnique.mockResolvedValue({
        id: 'file-1',
        uploadedBy: 'user-1',
        status: 'UPLOADING',
        originalKey: 'users/user-1/photos/file-1/original',
        mimetype: 'video/mp4',
      });
      storage.headObject.mockResolvedValue({ exists: true, size: 100, contentType: 'video/mp4' });

      const result = await service.complete('user-1', 'file-1');

      expect(prisma.media.update).toHaveBeenCalledWith({
        where: { id: 'file-1' },
        data: { status: 'PROCESSING' },
      });
      expect(videoQueue.enqueueVideoProcessing).toHaveBeenCalledWith({
        fileId: 'file-1',
        originalKey: 'users/user-1/photos/file-1/original',
        mimeType: 'video/mp4',
        userId: 'user-1',
      });
      expect(result).toEqual({ id: 'file-1', status: 'PROCESSING' });
    });

    it('returns early if already READY', async () => {
      prisma.media.findUnique.mockResolvedValue({
        id: 'file-1',
        uploadedBy: 'user-1',
        status: 'READY',
        originalKey: 'users/user-1/photos/file-1/original',
        mimetype: 'image/jpeg',
      });

      const result = await service.complete('user-1', 'file-1');

      expect(storage.headObject).not.toHaveBeenCalled();
      expect(prisma.media.update).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 'file-1', status: 'READY' });
    });

    it('rejects when the object does not exist in storage', async () => {
      prisma.media.findUnique.mockResolvedValue({
        id: 'file-1',
        uploadedBy: 'user-1',
        status: 'UPLOADING',
        originalKey: 'users/user-1/photos/file-1/original',
        mimetype: 'image/jpeg',
      });
      storage.headObject.mockResolvedValue({ exists: false, size: null, contentType: null });

      await expect(service.complete('user-1', 'file-1')).rejects.toThrow(BadRequestException);
      expect(prisma.media.update).not.toHaveBeenCalled();
    });
  });

  describe('access control', () => {
    it('findOne returns 404 for another user media', async () => {
      prisma.media.findUnique.mockResolvedValue({
        id: 'file-1',
        uploadedBy: 'user-B',
        type: 'PHOTO',
        status: 'READY',
        originalKey: 'k',
        previewKey: null,
        mediumKey: null,
        mimetype: 'image/jpeg',
        size: BigInt(10),
        width: null,
        height: null,
        duration: null,
      });

      await expect(service.findOne('user-A', 'file-1')).rejects.toThrow(NotFoundException);
    });

    it('findOne returns Worker signed URLs for READY media', async () => {
      prisma.media.findUnique.mockResolvedValue({
        id: 'file-1',
        uploadedBy: 'user-1',
        type: 'PHOTO',
        status: 'READY',
        originalKey: 'users/user-1/photos/file-1/original',
        previewKey: 'users/user-1/photos/file-1/preview',
        mediumKey: 'users/user-1/photos/file-1/medium',
        mimetype: 'image/jpeg',
        size: BigInt(10),
        width: 400,
        height: 300,
        duration: null,
      });

      const result = await service.findOne('user-1', 'file-1');

      expect(urlSigner.signAll).toHaveBeenCalledWith(
        'users/user-1/photos/file-1/original',
        expect.objectContaining({
          mediumKey: 'users/user-1/photos/file-1/medium',
          previewKey: 'users/user-1/photos/file-1/preview',
        }),
      );
      expect(result.previewUrl).toContain('worker.dev/image');
      expect(result.mediumUrl).toContain('worker.dev/image');
      expect(result.originalUrl).toContain('worker.dev/image');
      expect(result.thumbnailUrl).toContain('worker.dev/image');
    });

    it('findOne returns null URLs for non-READY media', async () => {
      prisma.media.findUnique.mockResolvedValue({
        id: 'file-1',
        uploadedBy: 'user-1',
        type: 'PHOTO',
        status: 'UPLOADING',
        originalKey: 'users/user-1/photos/file-1/original',
        previewKey: 'users/user-1/photos/file-1/preview',
        mediumKey: 'users/user-1/photos/file-1/medium',
        mimetype: 'image/jpeg',
        size: BigInt(10),
        width: 400,
        height: 300,
        duration: null,
      });

      const result = await service.findOne('user-1', 'file-1');

      expect(result.previewUrl).toBeNull();
      expect(result.mediumUrl).toBeNull();
      expect(result.originalUrl).toBeNull();
      expect(result.thumbnailUrl).toBeNull();
    });
  });
});
