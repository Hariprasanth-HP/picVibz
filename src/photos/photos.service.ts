import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ImageUrlSigner } from '../common/utils/image-url-signer';
import { randomUUID } from 'crypto';

const THUMB_WIDTH = 200;
const PREVIEW_WIDTH = 800;

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

    const fileRecord = await this.prisma.file.create({
      data: {
        id,
        userId,
        originalName: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        width: metadata.width ?? null,
        height: metadata.height ?? null,
        originalKey,
        originalUrl: originalKey,
        previewUrl: '',
        thumbnailUrl: '',
        status: 'READY',
      },
    });

    const photo = await this.prisma.photo.create({
      data: {
        eventId,
        fileId: id,
        uploadedBy: userId,
      },
      include: {
        file: true,
        user: {
          select: { id: true, displayName: true, photoURL: true },
        },
      },
    });

    return photo;
  }

  async findByEvent(eventId: string, userId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, createdBy: userId },
    });
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const photos = await this.prisma.photo.findMany({
      where: { eventId },
      include: {
        file: true,
        user: {
          select: { id: true, displayName: true, photoURL: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const expiration = Number(this.config.get('SIGNED_URL_EXPIRATION', '300'));
    return Promise.all(
      photos.map(async (photo) => {
        const file = photo.file;
        if (!file.originalKey) {
          return photo;
        }

        const ready = file.status === 'READY';
        const urls =
          ready && file.originalKey
            ? this.urlSigner.signAll(file.originalKey, {
                mediumKey: file.mediumKey ?? null,
                previewKey: file.previewKey ?? null,
                expiresInSeconds: expiration,
              })
            : {
                originalUrl: null,
                mediumUrl: null,
                previewUrl: null,
                thumbnailUrl: null,
              };

        return {
          ...photo,
          file: {
            ...file,
            status: file.status,
            originalUrl: urls.originalUrl,
            previewUrl: urls.previewUrl,
            thumbnailUrl: urls.thumbnailUrl,
            mediumUrl: urls.mediumUrl,
          },
        };
      }),
    );
  }

  async remove(eventId: string, photoId: string, userId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, createdBy: userId },
    });
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const photo = await this.prisma.photo.findFirst({
      where: { id: photoId, eventId },
      include: { file: true },
    });
    if (!photo) {
      throw new NotFoundException('Photo not found');
    }

    const keys = new Set<string>();
    if (photo.file.originalKey) {
      keys.add(photo.file.originalKey);
      if (photo.file.previewKey) keys.add(photo.file.previewKey);
      if (photo.file.mediumKey) keys.add(photo.file.mediumKey);
    } else {
      keys.add(`uploads/${photo.fileId}/original.jpg`);
      keys.add(`uploads/${photo.fileId}/preview.jpg`);
      keys.add(`uploads/${photo.fileId}/thumbnail.jpg`);
    }

    await Promise.all([...keys].map((key) => this.storage.delete(key)));

    await this.prisma.$transaction([
      this.prisma.photo.delete({ where: { id: photo.id } }),
      this.prisma.file.delete({ where: { id: photo.fileId } }),
    ]);

    return { message: 'Photo deleted successfully' };
  }
}
