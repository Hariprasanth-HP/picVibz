import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VideoProcessJobDto } from '../uploads/dto/video-process.dto';

@Injectable()
export class VideoQueueService {
  constructor(private readonly config: ConfigService) {}

  async enqueueVideoProcessing(job: VideoProcessJobDto): Promise<void> {
    const queueUrl = this.config.get<string>('VIDEO_QUEUE_URL');
    const authToken = this.config.get<string>('VIDEO_QUEUE_TOKEN');

    if (!queueUrl || !authToken) {
      throw new Error('Video queue not configured: VIDEO_QUEUE_URL and VIDEO_QUEUE_TOKEN required');
    }

    const response = await fetch(queueUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body: job }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to enqueue video processing: ${response.status} ${error}`);
    }
  }
}
