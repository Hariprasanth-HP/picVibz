import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { UploadsService } from './uploads.service';
import { ImageUrlSigner } from '../common/utils/image-url-signer';

describe('UploadsService', () => {
  let service: UploadsService;
  const prisma = {
    file: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    event: {
      findFirst: jest.fn(),
    },
    photo: {
      findUnique: jest.fn(),
      create: jest.fn(),
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
              };
              return defaults[key] ?? def;
            }),
            getOrThrow: jest.fn((key: string) => {
              const defaults: Record<string, string> = {
                UPLOAD_MAX_SIZE: '1048576000',
                SIGNED_URL_EXPIRATION: '300',
                IMAGE_WORKER_URL: 'https://worker.dev',
                IMAGE_SIGNING_SECRET: 'test-secret-key-32-chars-minimum-length',
              };
              return defaults[key];
            }),
          },
        },
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: ImageUrlSigner, useValue: urlSigner },
      ],
    }).compile();

    service = moduleRef.get(UploadsService);
  });

  describe('init', () => {
    it('creates an UPLOADING file record and returns a signed PUT URL', async () => {
      const created = {
        id: 'file-1',
        userId: 'user-1',
        originalName: 'IMG_1234.jpg',
        mimetype: 'image/jpeg',
        size: 4829382,
        status: 'UPLOADING',
        originalKey: 'users/user-1/photos/file-1/original',
      };
      prisma.file.create.mockResolvedValue(created);

      const result = await service.init('user-1', {
        fileName: 'IMG_1234.jpg',
        mimeType: 'image/jpeg',
        size: 4829382,
      });

      expect(prisma.file.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
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
      expect(prisma.file.create).not.toHaveBeenCalled();
    });

    it('rejects a file larger than UPLOAD_MAX_SIZE', async () => {
      await expect(
        service.init('user-1', {
          fileName: 'big.mp4',
          mimeType: 'video/mp4',
          size: Number.MAX_SAFE_INTEGER,
        }),
      ).rejects.toThrow(PayloadTooLargeException);
      expect(prisma.file.create).not.toHaveBeenCalled();
    });

    it('stores eventId when the event belongs to the user', async () => {
      prisma.event.findFirst.mockResolvedValue({
        id: 'event-1',
        createdBy: 'user-1',
      });
      prisma.file.create.mockResolvedValue({
        id: 'file-1',
        userId: 'user-1',
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
      expect(prisma.file.create).toHaveBeenCalledWith({
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
      expect(prisma.file.create).not.toHaveBeenCalled();
    });
  });

  describe('complete', () => {
    it('returns 404 when the upload belongs to another user', async () => {
      prisma.file.findUnique.mockResolvedValue({
        id: 'file-1',
        userId: 'user-B',
        status: 'UPLOADING',
        originalKey: 'users/user-B/photos/file-1/original',
        mimetype: 'image/jpeg',
      });

      await expect(service.complete('user-A', 'file-1')).rejects.toThrow(NotFoundException);
      expect(prisma.file.update).not.toHaveBeenCalled();
    });

    it('verifies object exists in storage and marks READY (no queue)', async () => {
      prisma.file.findUnique.mockResolvedValue({
        id: 'file-1',
        userId: 'user-1',
        status: 'UPLOADING',
        originalKey: 'users/user-1/photos/file-1/original',
        mimetype: 'image/jpeg',
      });
      storage.headObject.mockResolvedValue({ exists: true, size: 100, contentType: 'image/jpeg' });

      const result = await service.complete('user-1', 'file-1');

      expect(storage.headObject).toHaveBeenCalledWith('users/user-1/photos/file-1/original');
      expect(prisma.file.update).toHaveBeenCalledWith({
        where: { id: 'file-1' },
        data: { status: 'READY', width: null, height: null },
      });
      expect(result).toEqual({ id: 'file-1', status: 'READY' });
    });

    it('creates an event Photo idempotently when the file has an eventId', async () => {
      prisma.file.findUnique.mockResolvedValue({
        id: 'file-1',
        userId: 'user-1',
        status: 'UPLOADING',
        originalKey: 'users/user-1/photos/file-1/original',
        mimetype: 'image/jpeg',
        eventId: 'event-1',
      });
      storage.headObject.mockResolvedValue({ exists: true, size: 100, contentType: 'image/jpeg' });
      prisma.photo.findUnique.mockResolvedValue(null);

      const result = await service.complete('user-1', 'file-1');

      expect(prisma.photo.create).toHaveBeenCalledWith({
        data: {
          eventId: 'event-1',
          fileId: 'file-1',
          uploadedBy: 'user-1',
        },
      });
      expect(result).toEqual({ id: 'file-1', status: 'READY' });
    });

    it('does not duplicate an event Photo on retry', async () => {
      prisma.file.findUnique.mockResolvedValue({
        id: 'file-1',
        userId: 'user-1',
        status: 'UPLOADING',
        originalKey: 'users/user-1/photos/file-1/original',
        mimetype: 'image/jpeg',
        eventId: 'event-1',
      });
      storage.headObject.mockResolvedValue({ exists: true, size: 100, contentType: 'image/jpeg' });
      prisma.photo.findUnique.mockResolvedValue({ id: 'photo-1' });

      await service.complete('user-1', 'file-1');

      expect(prisma.photo.create).not.toHaveBeenCalled();
    });

    it('returns early if already READY', async () => {
      prisma.file.findUnique.mockResolvedValue({
        id: 'file-1',
        userId: 'user-1',
        status: 'READY',
        originalKey: 'users/user-1/photos/file-1/original',
        mimetype: 'image/jpeg',
      });

      const result = await service.complete('user-1', 'file-1');

      expect(storage.headObject).not.toHaveBeenCalled();
      expect(prisma.file.update).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 'file-1', status: 'READY' });
    });

    it('rejects when the object does not exist in storage', async () => {
      prisma.file.findUnique.mockResolvedValue({
        id: 'file-1',
        userId: 'user-1',
        status: 'UPLOADING',
        originalKey: 'users/user-1/photos/file-1/original',
        mimetype: 'image/jpeg',
      });
      storage.headObject.mockResolvedValue({ exists: false, size: null, contentType: null });

      await expect(service.complete('user-1', 'file-1')).rejects.toThrow(BadRequestException);
      expect(prisma.file.update).not.toHaveBeenCalled();
    });
  });

  describe('access control', () => {
    it('findOne returns 404 for another user media', async () => {
      prisma.file.findUnique.mockResolvedValue({
        id: 'file-1',
        userId: 'user-B',
        status: 'READY',
        originalKey: 'k',
        previewKey: null,
        mediumKey: null,
        mimetype: 'image/jpeg',
        size: 10,
        width: null,
        height: null,
        duration: null,
      });

      await expect(service.findOne('user-A', 'file-1')).rejects.toThrow(NotFoundException);
    });

    it('findOne returns Worker signed URLs for READY media', async () => {
      prisma.file.findUnique.mockResolvedValue({
        id: 'file-1',
        userId: 'user-1',
        status: 'READY',
        originalKey: 'users/user-1/photos/file-1/original',
        previewKey: 'users/user-1/photos/file-1/preview',
        mediumKey: 'users/user-1/photos/file-1/medium',
        mimetype: 'image/jpeg',
        size: 10,
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
      prisma.file.findUnique.mockResolvedValue({
        id: 'file-1',
        userId: 'user-1',
        status: 'UPLOADING',
        originalKey: 'users/user-1/photos/file-1/original',
        previewKey: 'users/user-1/photos/file-1/preview',
        mediumKey: 'users/user-1/photos/file-1/medium',
        mimetype: 'image/jpeg',
        size: 10,
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
