import { Injectable, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export const MEDIA_QUEUE_NAME = 'media-processing';
export const MEDIA_JOB_NAME = 'process-media';

export interface MediaJobPayload {
  fileId: string;
  userId: string;
  originalKey: string;
  mimeType: string;
}

@Injectable()
export class MediaQueueService {
  private readonly logger = new Logger(MediaQueueService.name);

  constructor(@InjectQueue(MEDIA_QUEUE_NAME) private readonly queue: Queue) {}

  async addMediaJob(payload: MediaJobPayload): Promise<string> {
    const job = await this.queue.add(MEDIA_JOB_NAME, payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 100 },
    });
    this.logger.log(
      `Queued media job jobId=${job.id} fileId=${payload.fileId} userId=${payload.userId} mimeType=${payload.mimeType}`,
    );
    return job.id ?? '';
  }
}

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get<string>('REDIS_URL', 'redis://localhost:6379'),
          maxRetriesPerRequest: null,
          enableOfflineQueue: false,
        },
      }),
    }),
    BullModule.registerQueue({ name: MEDIA_QUEUE_NAME }),
  ],
  providers: [MediaQueueService],
  exports: [MediaQueueService],
})
export class MediaQueueModule {}
