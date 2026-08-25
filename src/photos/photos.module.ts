import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { StorageModule } from '../storage/storage.module';
import { ImageUrlSigner } from '../common/utils/image-url-signer';
import { PhotosController } from './photos.controller';
import { PhotosService } from './photos.service';

@Module({
  imports: [StorageModule, ConfigModule],
  controllers: [PhotosController],
  providers: [
    PhotosService,
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
  ],
})
export class PhotosModule {}
