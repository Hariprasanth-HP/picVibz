import { Module } from '@nestjs/common';
import { VideoQueueService } from './video.queue';

@Module({
  providers: [VideoQueueService],
  exports: [VideoQueueService],
})
export class QueuesModule {}
