import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ImageProcessor } from '../processors/image.processor';
import { VideoProcessor } from '../processors/video.processor';
import { MediaWorker } from './media.worker';
import type { MediaJobPayload } from '../queues/media.queue';

const makeJob = (data: MediaJobPayload, opts?: Partial<Job>) =>
  ({
    id: 'job-1',
    data,
    opts: { attempts: 3, ...opts },
    attemptsMade: 1,
  }) as unknown as Job;

describe('MediaWorker', () => {
  let worker: MediaWorker;
  const prisma = { file: { findUnique: jest.fn(), update: jest.fn() } };
  const storage = {
    headObject: jest.fn(),
    download: jest.fn(),
  };
  const imageProcessor = { process: jest.fn() };
  const videoProcessor = { process: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        MediaWorker,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => (key === 'MEDIA_WORKER_CONCURRENCY' ? '3' : undefined)),
          },
        },
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: ImageProcessor, useValue: imageProcessor },
        { provide: VideoProcessor, useValue: videoProcessor },
      ],
    }).compile();

    worker = moduleRef.get(MediaWorker);
  });

  describe('handleJob', () => {
    it('processes an image and marks the file READY with derivatives', async () => {
      const file = {
        id: 'file-1',
        userId: 'user-1',
        status: 'UPLOADED',
        originalKey: 'users/user-1/photos/file-1/original',
        previewKey: null,
        mediumKey: null,
        previewUrl: '',
        thumbnailUrl: '',
      };
      prisma.file.findUnique.mockResolvedValue(file);
      storage.download.mockResolvedValue(Buffer.from('original-bytes'));
      imageProcessor.process.mockResolvedValue({
        mediumKey: 'users/user-1/photos/file-1/medium',
        previewKey: 'users/user-1/photos/file-1/preview',
        width: 400,
        height: 300,
        duration: null,
      });

      await worker.handleJob(
        makeJob({
          fileId: 'file-1',
          userId: 'user-1',
          originalKey: file.originalKey,
          mimeType: 'image/jpeg',
        }),
      );

      expect(prisma.file.update).toHaveBeenCalledWith({
        where: { id: 'file-1' },
        data: { status: 'PROCESSING', processingError: null },
      });
      expect(prisma.file.update).toHaveBeenCalledWith({
        where: { id: 'file-1' },
        data: expect.objectContaining({
          status: 'READY',
          mediumKey: 'users/user-1/photos/file-1/medium',
          previewKey: 'users/user-1/photos/file-1/preview',
          width: 400,
          height: 300,
        }),
      });
    });

    it('is idempotent: skips when already READY and derivatives exist', async () => {
      const file = {
        id: 'file-1',
        userId: 'user-1',
        status: 'READY',
        originalKey: 'users/user-1/photos/file-1/original',
        previewKey: 'users/user-1/photos/file-1/preview',
        mediumKey: 'users/user-1/photos/file-1/medium',
        previewUrl: '',
        thumbnailUrl: '',
      };
      prisma.file.findUnique.mockResolvedValue(file);
      storage.headObject.mockResolvedValue({ exists: true });

      await worker.handleJob(
        makeJob({
          fileId: 'file-1',
          userId: 'user-1',
          originalKey: file.originalKey,
          mimeType: 'image/jpeg',
        }),
      );

      expect(storage.download).not.toHaveBeenCalled();
      expect(imageProcessor.process).not.toHaveBeenCalled();
      expect(prisma.file.update).not.toHaveBeenCalled();
    });

    it('rethrows processing errors so BullMQ can retry', async () => {
      const file = {
        id: 'file-1',
        userId: 'user-1',
        status: 'UPLOADED',
        originalKey: 'users/user-1/photos/file-1/original',
        previewKey: null,
        mediumKey: null,
        previewUrl: '',
        thumbnailUrl: '',
      };
      prisma.file.findUnique.mockResolvedValue(file);
      storage.download.mockRejectedValue(new Error('download failed'));

      await expect(
        worker.handleJob(
          makeJob({
            fileId: 'file-1',
            userId: 'user-1',
            originalKey: file.originalKey,
            mimeType: 'image/jpeg',
          }),
        ),
      ).rejects.toThrow('download failed');
    });

    it('dispatches videos to the video processor', async () => {
      const file = {
        id: 'file-1',
        userId: 'user-1',
        status: 'UPLOADED',
        originalKey: 'users/user-1/photos/file-1/original',
        previewKey: null,
        mediumKey: null,
        previewUrl: '',
        thumbnailUrl: '',
      };
      prisma.file.findUnique.mockResolvedValue(file);
      storage.download.mockResolvedValue(Buffer.from('video-bytes'));
      videoProcessor.process.mockResolvedValue({
        mediumKey: null,
        previewKey: 'users/user-1/photos/file-1/preview',
        width: null,
        height: null,
        duration: 120,
      });

      await worker.handleJob(
        makeJob({
          fileId: 'file-1',
          userId: 'user-1',
          originalKey: file.originalKey,
          mimeType: 'video/mp4',
        }),
      );

      expect(videoProcessor.process).toHaveBeenCalled();
      expect(prisma.file.update).toHaveBeenCalledWith({
        where: { id: 'file-1' },
        data: expect.objectContaining({ status: 'READY', duration: 120 }),
      });
    });
  });

  describe('handleFailed', () => {
    it('marks the file FAILED only after all attempts are exhausted', async () => {
      const job = makeJob({
        fileId: 'file-1',
        userId: 'user-1',
        originalKey: 'k',
        mimeType: 'image/jpeg',
      });
      job.attemptsMade = 3;

      await worker.handleFailed(job, new Error('boom'));

      expect(prisma.file.update).toHaveBeenCalledWith({
        where: { id: 'file-1' },
        data: expect.objectContaining({
          status: 'FAILED',
          processingError: 'boom',
        }),
      });
    });

    it('does not mark FAILED while attempts remain', async () => {
      const job = makeJob({
        fileId: 'file-1',
        userId: 'user-1',
        originalKey: 'k',
        mimeType: 'image/jpeg',
      });
      job.attemptsMade = 1;

      await worker.handleFailed(job, new Error('boom'));

      expect(prisma.file.update).not.toHaveBeenCalled();
    });
  });
});
