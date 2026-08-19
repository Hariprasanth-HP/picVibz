import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { randomUUID } from 'crypto';

const THUMB_WIDTH = 200;
const PREVIEW_WIDTH = 800;

@Injectable()
export class PhotosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
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
    const prefix = `uploads/${id}`;

    const metadata = await sharp(file.buffer).metadata();

    const thumbnail = await sharp(file.buffer)
      .resize(THUMB_WIDTH, undefined, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toBuffer();

    const preview = await sharp(file.buffer)
      .resize(PREVIEW_WIDTH, undefined, { fit: 'inside' })
      .jpeg({ quality: 85 })
      .toBuffer();

    const [originalUrl, previewUrl, thumbnailUrl] = await Promise.all([
      this.storage.upload(`${prefix}/original.jpg`, file.buffer, file.mimetype),
      this.storage.upload(`${prefix}/preview.jpg`, preview, 'image/jpeg'),
      this.storage.upload(`${prefix}/thumbnail.jpg`, thumbnail, 'image/jpeg'),
    ]);

    const fileRecord = await this.prisma.file.create({
      data: {
        id,
        originalName: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        width: metadata.width ?? null,
        height: metadata.height ?? null,
        originalUrl,
        previewUrl,
        thumbnailUrl,
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

    const expiration = Number(this.config.get('SIGNED_URL_EXPIRATION', '3600'));
    return Promise.all(
      photos.map(async (photo) => {
        const file = photo.file;
        if (!file.originalKey) {
          return photo;
        }

        const ready = file.status === 'READY';
        const sign = (key: string | null) =>
          ready && key ? this.storage.createPresignedGetUrl(key, expiration) : Promise.resolve('');

        const [originalUrl, previewUrl, mediumUrl] = await Promise.all([
          sign(file.originalKey),
          sign(file.previewKey),
          sign(file.mediumKey),
        ]);

        return {
          ...photo,
          file: {
            ...file,
            status: file.status,
            originalUrl,
            previewUrl,
            thumbnailUrl: previewUrl,
            mediumUrl,
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
