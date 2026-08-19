import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { ImageProcessor } from './image.processor';
import { VideoProcessor } from './video.processor';

@Module({
  imports: [StorageModule],
  providers: [ImageProcessor, VideoProcessor],
  exports: [ImageProcessor, VideoProcessor],
})
export class ProcessorsModule {}
