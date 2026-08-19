import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { ProcessorsModule } from '../processors/processors.module';
import { MediaWorker } from './media.worker';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    PrismaModule,
    StorageModule,
    ProcessorsModule,
  ],
  providers: [MediaWorker],
})
export class WorkerModule {}
