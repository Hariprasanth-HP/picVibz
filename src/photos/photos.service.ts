import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ImageUrlSigner } from '../common/utils/image-url-signer';
import { randomUUID } from 'crypto';

@Injectable()
export class PhotosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
    private readonly urlSigner: ImageUrlSigner,
  ) {}

  async upload(eventId: string, file: Express.Multer.File, userId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, createdBy: userId },
    });
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('Only image files are allowed');
    }

    const id = randomUUID();
    const originalKey = this.storage.buildKey(userId, id, 'original');

    const metadata = await sharp(file.buffer).metadata();

    await this.storage.upload(originalKey, file.buffer, file.mimetype);

    const created = await this.prisma.media.create({
      data: {
        id,
        type: 'PHOTO',
        uploadedBy: userId,
        eventId,
        originalName: file.originalname,
        mimetype: file.mimetype,
        size: BigInt(file.size),
        width: metadata.width ?? null,
        height: metadata.height ?? null,
        originalKey,
        status: 'READY',
      },
      include: {
        uploader: {
          select: { id: true, displayName: true, photoURL: true },
        },
      },
    });

    return {
      ...created,
      size: Number(created.size),
      duration: created.duration !== null ? Number(created.duration) : null,
    };
  }

  async findByEvent(eventId: string, userId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, createdBy: userId },
    });
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const media = await this.prisma.media.findMany({
      where: { eventId, type: 'PHOTO' },
      include: {
        uploader: {
          select: { id: true, displayName: true, photoURL: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const expiration = Number(this.config.get('SIGNED_URL_EXPIRATION', '300'));
    return media.map((item) => {
      const normalized = {
        ...item,
        size: Number(item.size),
        duration: item.duration !== null ? Number(item.duration) : null,
      };

      if (!normalized.originalKey) {
        return normalized;
      }

      const ready = item.status === 'READY';
      const urls =
        ready && item.originalKey
          ? this.urlSigner.signAll(item.originalKey, {
              mediumKey: item.mediumKey ?? null,
              previewKey: item.previewKey ?? null,
              expiresInSeconds: expiration,
            })
          : {
              originalUrl: null,
              mediumUrl: null,
              previewUrl: null,
              thumbnailUrl: null,
            };

      return {
        ...normalized,
        originalUrl: urls.originalUrl,
        previewUrl: urls.previewUrl,
        thumbnailUrl: urls.thumbnailUrl,
        mediumUrl: urls.mediumUrl,
      };
    });
  }

  async remove(eventId: string, photoId: string, userId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, createdBy: userId },
    });
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const media = await this.prisma.media.findFirst({
      where: { id: photoId, eventId, type: 'PHOTO' },
    });
    if (!media) {
      throw new NotFoundException('Photo not found');
    }

    const keys = new Set<string>();
    if (media.originalKey) keys.add(media.originalKey);
    if (media.previewKey) keys.add(media.previewKey);
    if (media.mediumKey) keys.add(media.mediumKey);
    if (media.thumbnailKey) keys.add(media.thumbnailKey);

    await Promise.all([...keys].map((key) => this.storage.delete(key)));

    await this.prisma.media.delete({ where: { id: media.id } });

    return { message: 'Photo deleted successfully' };
  }
}
