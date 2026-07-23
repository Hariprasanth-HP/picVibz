import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { PhotosController } from './photos.controller';
import { PhotosService } from './photos.service';

@Module({
  imports: [StorageModule],
  controllers: [PhotosController],
  providers: [PhotosService],
})
export class PhotosModule {}
