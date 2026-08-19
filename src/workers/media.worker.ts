import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ImageProcessor } from '../processors/image.processor';
import { VideoProcessor } from '../processors/video.processor';
import { MEDIA_QUEUE_NAME, MediaJobPayload } from '../queues/media.queue';
import {
  isImageMimeType,
  isVideoMimeType,
} from '../uploads/media.constants';

@Injectable()
export class MediaWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaWorker.name);
  private worker: Worker | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly imageProcessor: ImageProcessor,
    private readonly videoProcessor: VideoProcessor,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const redisUrl = this.config.get<string>(
      'REDIS_URL',
      'redis://localhost:6379',
    );
    const concurrency = Number(
      this.config.get('MEDIA_WORKER_CONCURRENCY', '3'),
    ) || 3;

    this.worker = new Worker(
      MEDIA_QUEUE_NAME,
      async (job: Job<MediaJobPayload>) => this.handleJob(job),
      {
        connection: { url: redisUrl },
        concurrency,
        lockDuration: 300000,
      },
    );

    this.worker.on('failed', (job, err) => this.handleFailed(job, err));
    this.worker.on('error', (err) =>
      this.logger.error('Media worker connection error', err),
    );

    this.logger.log(
      `Media worker started queue=${MEDIA_QUEUE_NAME} concurrency=${concurrency}`,
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
    this.logger.log('Media worker stopped');
  }

  async handleJob(job: Job<MediaJobPayload>): Promise<void> {
    const { fileId, userId, originalKey, mimeType } = job.data;
    const startedAt = Date.now();

    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) {
      throw new Error(`File not found for job fileId=${fileId}`);
    }

    if (file.status === 'READY') {
      const mediumExists = file.mediumKey
        ? (await this.storage.headObject(file.mediumKey)).exists
        : true;
      const previewExists = file.previewKey
        ? (await this.storage.headObject(file.previewKey)).exists
        : true;
      if (mediumExists && previewExists) {
        this.logger.log(
          `Already READY, skipping duplicate job jobId=${job.id} fileId=${fileId}`,
        );
        return;
      }
    }

    await this.prisma.file.update({
      where: { id: fileId },
      data: { status: 'PROCESSING', processingError: null },
    });

    const original = await this.storage.download(originalKey);

    let result;
    if (isImageMimeType(mimeType)) {
      result = await this.imageProcessor.process({
        userId,
        fileId,
        original,
        mimeType,
      });
    } else if (isVideoMimeType(mimeType)) {
      result = await this.videoProcessor.process({
        userId,
        fileId,
        original,
        mimeType,
      });
    } else {
      throw new Error(
        `Unsupported media type mimeType=${mimeType} fileId=${fileId}`,
      );
    }

    await this.prisma.file.update({
      where: { id: fileId },
      data: {
        status: 'READY',
        mediumKey: result.mediumKey,
        previewKey: result.previewKey,
        width: result.width,
        height: result.height,
        duration: result.duration,
        processingError: null,
        previewUrl: result.previewKey ?? file.previewUrl,
        thumbnailUrl: file.thumbnailUrl,
      },
    });

    this.logger.log(
      `Processed media jobId=${job.id} fileId=${fileId} userId=${userId} status=READY duration=${Date.now() - startedAt}ms mimeType=${mimeType}`,
    );
  }

  async handleFailed(
    job: Job<MediaJobPayload> | undefined,
    err: Error,
  ): Promise<void> {
    if (!job) return;
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade >= attempts) {
      try {
        await this.prisma.file.update({
          where: { id: job.data.fileId },
          data: { status: 'FAILED', processingError: err.message },
        });
        this.logger.error(
          `Media job failed jobId=${job.id} fileId=${job.data.fileId} userId=${job.data.userId} attempts=${job.attemptsMade}`,
          err.stack,
        );
      } catch (updateErr) {
        this.logger.error(
          `Failed to persist failure state fileId=${job.data.fileId}`,
          updateErr,
        );
      }
    }
  }
}