import { INestApplication, ValidationPipe } from '@nestjs/common';
import { CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';
import { MediaQueueService } from '../src/queues/media.queue';
import { UploadsController } from '../src/uploads/uploads.controller';
import { UploadsService } from '../src/uploads/uploads.service';

let authenticated = true;

class MockAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (!authenticated) throw new UnauthorizedException();
    const req = context.switchToHttp().getRequest();
    req.user = { id: 'user-A' };
    return true;
  }
}

describe('Uploads (e2e)', () => {
  let app: INestApplication;
  const prisma = {
    file: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };
  const storage = {
    buildKey: jest.fn(
      (userId: string, fileId: string, variant: string) =>
        `users/${userId}/photos/${fileId}/${variant}`,
    ),
    createPresignedPutUrl: jest.fn().mockResolvedValue('https://signed.put/url'),
    createPresignedGetUrl: jest.fn().mockResolvedValue('https://signed.get/url'),
    headObject: jest.fn().mockResolvedValue({ exists: true }),
  };
  const mediaQueue = { addMediaJob: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UploadsController],
      providers: [
        UploadsService,
        { provide: ConfigService, useValue: { get: jest.fn((_: string, def?: string) => def) } },
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: MediaQueueService, useValue: mediaQueue },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(new MockAuthGuard())
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    authenticated = true;
    prisma.file.create.mockResolvedValue({
      id: 'file-1',
      userId: 'user-A',
      status: 'UPLOADING',
      originalKey: 'users/user-A/photos/file-1/original',
    });
    prisma.file.findUnique.mockResolvedValue({
      id: 'b7f0e2c4-1a2b-3c4d-8e9f-000000000001',
      userId: 'user-A',
      status: 'UPLOADING',
      originalKey: 'users/user-A/photos/file-1/original',
      mimetype: 'image/jpeg',
    });
  });

  it('rejects requests without a valid JWT', async () => {
    authenticated = false;
    const res = await request(app.getHttpServer())
      .post('/api/v1/uploads/init')
      .send({ fileName: 'a.jpg', mimeType: 'image/jpeg', size: 100 });

    expect(res.status).toBe(401);
  });

  it('rejects invalid payloads (unsupported mime type)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/uploads/init')
      .send({ fileName: 'a.exe', mimeType: 'application/x-msdownload', size: 100 });

    expect(res.status).toBe(400);
  });

  it('initializes an upload and returns a signed URL', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/uploads/init')
      .send({ fileName: 'a.jpg', mimeType: 'image/jpeg', size: 100 });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(
      expect.objectContaining({ status: 'UPLOADING', uploadUrl: 'https://signed.put/url' }),
    );
  });

  it('completes an upload and returns PROCESSING', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/uploads/b7f0e2c4-1a2b-3c4d-8e9f-000000000001/complete')
      .send();

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PROCESSING');
    expect(mediaQueue.addMediaJob).toHaveBeenCalled();
  });

  it('returns 404 for media owned by another user', async () => {
    prisma.file.findUnique.mockResolvedValue({
      id: 'b7f0e2c4-1a2b-3c4d-8e9f-000000000001',
      userId: 'user-B',
      status: 'READY',
      originalKey: 'users/user-B/photos/file-1/original',
      mimetype: 'image/jpeg',
    });

    const res = await request(app.getHttpServer())
      .get('/api/v1/uploads/b7f0e2c4-1a2b-3c4d-8e9f-000000000001')
      .send();

    expect(res.status).toBe(404);
  });
});
