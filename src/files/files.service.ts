import { Injectable, BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { randomUUID } from 'crypto';

const THUMB_WIDTH = 200;
const PREVIEW_WIDTH = 800;

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async upload(file: Express.Multer.File) {
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

    return this.prisma.file.create({
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
  }

  async findAll() {
    return this.prisma.file.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string) {
    return this.prisma.file.findUniqueOrThrow({ where: { id } });
  }

  async remove(id: string) {
    const file = await this.findOne(id);
    const prefix = `uploads/${id}`;
    await Promise.all([
      this.storage.delete(`${prefix}/original.jpg`),
      this.storage.delete(`${prefix}/preview.jpg`),
      this.storage.delete(`${prefix}/thumbnail.jpg`),
    ]);
    await this.prisma.file.delete({ where: { id } });
  }
}
