import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import type { Media as PrismaMedia } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ImageUrlSigner } from '../common/utils/image-url-signer';
import { VideoUrlSigner } from '../common/utils/video-url-signer';
import { VideoQueueService } from '../queues/video.queue';
import { InitUploadDto } from './dto/init-upload.dto';
import { isAllowedMimeType, isVideoMimeType } from './media.constants';

@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
    private readonly urlSigner: ImageUrlSigner,
    private readonly videoSigner: VideoUrlSigner,
    private readonly videoQueue: VideoQueueService,
  ) {}

  private get uploadMaxSize(): number {
    return Number(this.config.get('UPLOAD_MAX_SIZE', '1048576000'));
  }

  private get signedUrlExpiration(): number {
    return Number(this.config.get('SIGNED_URL_EXPIRATION', '300'));
  }

  async init(userId: string, dto: InitUploadDto) {
    if (!isAllowedMimeType(dto.mimeType)) {
      throw new BadRequestException(`Unsupported media type: ${dto.mimeType}`);
    }
    if (dto.size > this.uploadMaxSize) {
      throw new PayloadTooLargeException(`File size exceeds limit of ${this.uploadMaxSize} bytes`);
    }

    let eventId: string | undefined;
    if (dto.eventId) {
      const event = await this.prisma.event.findFirst({
        where: { id: dto.eventId, createdBy: userId },
      });
      if (!event) {
        throw new NotFoundException('Event not found');
      }
      eventId = event.id;
    }

    const fileId = randomUUID();
    const originalKey = this.storage.buildKey(userId, fileId, 'original');

    const media = await this.prisma.media.create({
      data: {
        id: fileId,
        type: isVideoMimeType(dto.mimeType) ? 'VIDEO' : 'PHOTO',
        uploadedBy: userId,
        originalName: dto.fileName,
        mimetype: dto.mimeType,
        size: BigInt(dto.size),
        status: 'UPLOADING',
        originalKey: originalKey,
        ...(eventId ? { eventId } : {}),
      },
    });

    const uploadUrl = await this.storage.createPresignedPutUrl(
      originalKey,
      dto.mimeType,
      this.signedUrlExpiration,
    );

    return {
      uploadId: media.id,
      fileId: media.id,
      uploadUrl,
      storageKey: originalKey,
      status: media.status,
    };
  }

  async complete(userId: string, uploadId: string) {
    const media = await this.prisma.media.findUnique({
      where: { id: uploadId },
    });
    if (!media || media.uploadedBy !== userId) {
      throw new NotFoundException('Upload not found');
    }

    if (media.status === 'READY') {
      return { id: media.id, status: media.status };
    }

    if (!media.originalKey) {
      throw new BadRequestException('Upload is missing a storage key');
    }

    const head = await this.storage.headObject(media.originalKey);
    if (!head.exists) {
      throw new BadRequestException('Uploaded object not found in storage');
    }

    if (isVideoMimeType(media.mimetype)) {
      await this.prisma.media.update({
        where: { id: media.id },
        data: { status: 'PROCESSING' },
      });

      await this.videoQueue.enqueueVideoProcessing({
        fileId: media.id,
        originalKey: media.originalKey,
        mimeType: media.mimetype,
        userId,
      });

      return { id: media.id, status: 'PROCESSING' };
    }

    await this.prisma.media.update({
      where: { id: media.id },
      data: { status: 'READY' },
    });

    return { id: media.id, status: 'READY' };
  }

  async completeFromWorker(
    fileId: string,
    dto: {
      videoMp4Key: string;
      posterKey: string;
      previewGifKey: string;
      duration: number;
      width: number;
      height: number;
    },
  ) {
    const media = await this.prisma.media.findUnique({ where: { id: fileId } });
    if (!media) {
      throw new NotFoundException('Upload not found');
    }

    await this.prisma.media.update({
      where: { id: fileId },
      data: {
        status: 'READY',
        videoMp4Key: dto.videoMp4Key,
        posterKey: dto.posterKey,
        previewGifKey: dto.previewGifKey,
        duration: BigInt(dto.duration),
        width: dto.width,
        height: dto.height,
      },
    });

    return { id: fileId, status: 'READY' };
  }

  async findAll(userId: string) {
    const media = await this.prisma.media.findMany({
      where: { uploadedBy: userId },
      orderBy: { createdAt: 'desc' },
    });
    return media.map((m) => this.toMediaResponse(m));
  }

  async findOne(userId: string, id: string) {
    const media = await this.prisma.media.findUnique({ where: { id } });
    if (!media || media.uploadedBy !== userId) {
      throw new NotFoundException('Media not found');
    }
    return this.toMediaResponse(media);
  }

  private toMediaResponse(media: PrismaMedia) {
    const ready = media.status === 'READY';
    const isVideo = media.type === 'VIDEO';

    if (isVideo) {
      const urls =
        ready && media.originalKey && media.videoMp4Key
          ? this.videoSigner.signAll(media.originalKey, {
              videoKey: media.videoMp4Key,
              posterKey: media.posterKey ?? null,
              previewKey: media.previewGifKey ?? null,
              expiresInSeconds: this.signedUrlExpiration,
            })
          : {
              videoUrl: null,
              posterUrl: null,
              previewUrl: null,
            };

      return {
        id: media.id,
        eventId: media.eventId,
        status: media.status,
        type: media.type,
        mimeType: media.mimetype,
        size: Number(media.size),
        width: media.width,
        height: media.height,
        duration: media.duration !== null ? Number(media.duration) : null,
        videoUrl: urls.videoUrl,
        posterUrl: urls.posterUrl,
        previewUrl: urls.previewUrl,
        createdAt: media.createdAt,
        updatedAt: media.updatedAt,
      };
    }

    const urls =
      ready && media.originalKey
        ? this.urlSigner.signAll(media.originalKey, {
            mediumKey: media.mediumKey ?? null,
            previewKey: media.previewKey ?? null,
            thumbnailKey: media.thumbnailKey ?? null,
            expiresInSeconds: this.signedUrlExpiration,
          })
        : {
            originalUrl: null,
            mediumUrl: null,
            previewUrl: null,
            thumbnailUrl: null,
          };

    return {
      id: media.id,
      eventId: media.eventId,
      status: media.status,
      type: media.type,
      mimeType: media.mimetype,
      size: Number(media.size),
      width: media.width,
      height: media.height,
      duration: media.duration !== null ? Number(media.duration) : null,
      previewUrl: urls.previewUrl,
      mediumUrl: urls.mediumUrl,
      originalUrl: urls.originalUrl,
      thumbnailUrl: urls.thumbnailUrl,
      createdAt: media.createdAt,
      updatedAt: media.updatedAt,
    };
  }
}
