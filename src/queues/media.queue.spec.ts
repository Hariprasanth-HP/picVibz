import { Test } from '@nestjs/testing';
import { MediaQueueService } from './media.queue';

describe('MediaQueueService', () => {
  let service: MediaQueueService;
  const queue = { add: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MediaQueueService,
        { provide: 'BullQueue_media-processing', useValue: queue },
      ],
    }).compile();
    service = moduleRef.get(MediaQueueService);
  });

  it('adds a job with the correct name and metadata-only payload', async () => {
    queue.add.mockResolvedValue({ id: 'job-1' });

    const jobId = await service.addMediaJob({
      fileId: 'file-1',
      userId: 'user-1',
      originalKey: 'users/user-1/photos/file-1/original',
      mimeType: 'image/jpeg',
    });

    expect(jobId).toBe('job-1');
    expect(queue.add).toHaveBeenCalledWith(
      'process-media',
      {
        fileId: 'file-1',
        userId: 'user-1',
        originalKey: 'users/user-1/photos/file-1/original',
        mimeType: 'image/jpeg',
      },
      expect.objectContaining({
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      }),
    );
  });
});