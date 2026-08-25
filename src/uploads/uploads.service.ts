import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import type { File as MediaFile } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ImageUrlSigner } from '../common/utils/image-url-signer';
import { InitUploadDto } from './dto/init-upload.dto';
import { isAllowedMimeType } from './media.constants';

@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
    private readonly urlSigner: ImageUrlSigner,
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

    const file = await this.prisma.file.create({
      data: {
        id: fileId,
        userId,
        originalName: dto.fileName,
        mimetype: dto.mimeType,
        size: dto.size,
        status: 'UPLOADING',
        originalKey,
        originalUrl: originalKey,
        previewUrl: '',
        thumbnailUrl: '',
        ...(eventId ? { eventId } : {}),
      },
    });

    const uploadUrl = await this.storage.createPresignedPutUrl(
      originalKey,
      dto.mimeType,
      this.signedUrlExpiration,
    );

    return {
      uploadId: file.id,
      fileId: file.id,
      uploadUrl,
      storageKey: originalKey,
      status: file.status,
    };
  }

  async complete(userId: string, uploadId: string) {
    const file = await this.prisma.file.findUnique({
      where: { id: uploadId },
    });
    if (!file || file.userId !== userId) {
      throw new NotFoundException('Upload not found');
    }

    if (file.status === 'READY') {
      return { id: file.id, status: file.status };
    }

    if (!file.originalKey) {
      throw new BadRequestException('Upload is missing a storage key');
    }

    const head = await this.storage.headObject(file.originalKey);
    if (!head.exists) {
      throw new BadRequestException('Uploaded object not found in storage');
    }

    if (file.eventId) {
      const existing = await this.prisma.photo.findUnique({
        where: { fileId: file.id },
      });
      if (!existing) {
        await this.prisma.photo.create({
          data: {
            eventId: file.eventId,
            fileId: file.id,
            uploadedBy: userId,
          },
        });
      }
    }

    await this.prisma.file.update({
      where: { id: file.id },
      data: {
        status: 'READY',
        width: head.contentType?.startsWith('image/') ? null : null,
        height: head.contentType?.startsWith('image/') ? null : null,
      },
    });

    return { id: file.id, status: 'READY' };
  }

  async findAll(userId: string) {
    const files = await this.prisma.file.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(files.map((file) => this.toMediaResponse(file)));
  }

  async findOne(userId: string, id: string) {
    const file = await this.prisma.file.findUnique({ where: { id } });
    if (!file || file.userId !== userId) {
      throw new NotFoundException('Media not found');
    }
    return this.toMediaResponse(file);
  }

  private toMediaResponse(file: MediaFile) {
    const ready = file.status === 'READY';
    const urls =
      ready && file.originalKey
        ? this.urlSigner.signAll(file.originalKey, {
            mediumKey: file.mediumKey ?? null,
            previewKey: file.previewKey ?? null,
            expiresInSeconds: this.signedUrlExpiration,
          })
        : {
            originalUrl: null,
            mediumUrl: null,
            previewUrl: null,
            thumbnailUrl: null,
          };

    return {
      id: file.id,
      eventId: file.eventId,
      status: file.status,
      mimeType: file.mimetype,
      size: file.size,
      width: file.width,
      height: file.height,
      duration: file.duration,
      previewUrl: urls.previewUrl,
      mediumUrl: urls.mediumUrl,
      originalUrl: urls.originalUrl,
      thumbnailUrl: urls.thumbnailUrl,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    };
  }
}
