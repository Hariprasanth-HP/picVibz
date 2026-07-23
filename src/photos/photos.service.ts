import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
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

    return this.prisma.photo.findMany({
      where: { eventId },
      include: {
        file: true,
        user: {
          select: { id: true, displayName: true, photoURL: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
