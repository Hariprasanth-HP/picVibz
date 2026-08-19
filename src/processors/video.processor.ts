import { Injectable, Logger } from '@nestjs/common';
import ffmpegPath from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { StorageService } from '../storage/storage.service';
import type { MediaProcessInput, MediaProcessResult } from './media-process.types';

const execFileAsync = promisify(execFile);

const POSTER_FRAME_SECONDS = 1;
const POSTER_JPEG_QUALITY = '3';

@Injectable()
export class VideoProcessor {
  private readonly logger = new Logger(VideoProcessor.name);

  constructor(private readonly storage: StorageService) {}

  async process(input: MediaProcessInput): Promise<MediaProcessResult> {
    const { userId, fileId, original } = input;

    if (!ffmpegPath) {
      throw new Error('ffmpeg-static binary not available');
    }

    const previewKey = this.storage.buildKey(userId, fileId, 'preview');
    const previewHead = await this.storage.headObject(previewKey);

    const tmpDir = await mkdtemp(join(tmpdir(), `picvibz-video-`));
    const videoPath = join(tmpDir, `${fileId}-${randomUUID()}.mp4`);
    const posterPath = join(tmpDir, `${fileId}-poster-${randomUUID()}.jpg`);

    try {
      await writeFile(videoPath, original);

      const duration = await this.probeDuration(videoPath);

      if (previewHead.exists) {
        this.logger.log(`Poster already exists, skipping fileId=${fileId} preview=${previewKey}`);
        return { mediumKey: null, previewKey, width: null, height: null, duration };
      }

      await execFileAsync(ffmpegPath, [
        '-ss',
        String(POSTER_FRAME_SECONDS),
        '-i',
        videoPath,
        '-frames:v',
        '1',
        '-q:v',
        POSTER_JPEG_QUALITY,
        '-y',
        posterPath,
      ]);

      const poster = await readFile(posterPath);
      await this.storage.upload(previewKey, poster, 'image/jpeg');

      this.logger.log(
        `Processed video fileId=${fileId} duration=${duration} preview=${previewKey}`,
      );

      return { mediumKey: null, previewKey, width: null, height: null, duration };
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }

  private async probeDuration(videoPath: string): Promise<number | null> {
    try {
      const { stdout } = await execFileAsync(ffprobe.path, [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        videoPath,
      ]);
      const seconds = Number.parseFloat(stdout.trim());
      return Number.isFinite(seconds) ? Math.round(seconds) : null;
    } catch (err) {
      this.logger.warn(`Failed to probe video duration path=${videoPath}`, err);
      return null;
    }
  }
}
