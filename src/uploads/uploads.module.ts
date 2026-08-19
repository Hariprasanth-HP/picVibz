import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { MediaQueueModule } from '../queues/media.queue';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  imports: [StorageModule, MediaQueueModule],
  controllers: [UploadsController],
  providers: [UploadsService],
})
export class UploadsModule {}
