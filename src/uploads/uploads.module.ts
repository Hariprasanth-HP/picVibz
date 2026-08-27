import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { StorageModule } from '../storage/storage.module';
import { QueuesModule } from '../queues/queues.module';
import { ImageUrlSigner } from '../common/utils/image-url-signer';
import { VideoUrlSigner } from '../common/utils/video-url-signer';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  imports: [StorageModule, ConfigModule, QueuesModule],
  controllers: [UploadsController],
  providers: [
    UploadsService,
    {
      provide: ImageUrlSigner,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const workerUrl = config.getOrThrow<string>('IMAGE_WORKER_URL');
        const signingSecret = config.getOrThrow<string>('IMAGE_SIGNING_SECRET');
        return new ImageUrlSigner({
          baseUrl: workerUrl,
          secret: signingSecret,
          defaultExpirySeconds: Number(config.get('SIGNED_URL_EXPIRATION', '300')),
        });
      },
    },
    {
      provide: VideoUrlSigner,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const workerUrl = config.getOrThrow<string>('VIDEO_WORKER_URL');
        const signingSecret = config.getOrThrow<string>('IMAGE_SIGNING_SECRET');
        return new VideoUrlSigner({
          baseUrl: workerUrl,
          secret: signingSecret,
          defaultExpirySeconds: Number(config.get('SIGNED_URL_EXPIRATION', '300')),
        });
      },
    },
  ],
})
export class UploadsModule {}
