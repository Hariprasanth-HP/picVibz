import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsInt, IsPositive, IsNumber } from 'class-validator';

export class VideoProcessJobDto {
  @ApiProperty({ example: 'cm8x2abc...' })
  @IsString()
  @IsNotEmpty()
  fileId: string;

  @ApiProperty({ example: 'users/user-1/photos/file-1/original' })
  @IsString()
  @IsNotEmpty()
  originalKey: string;

  @ApiProperty({ example: 'video/quicktime' })
  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @ApiProperty({ example: 'user-1' })
  @IsString()
  @IsNotEmpty()
  userId: string;
}

export class VideoCompleteDto {
  @ApiProperty({ example: 'users/user-1/photos/file-1/video.mp4' })
  @IsString()
  @IsNotEmpty()
  videoMp4Key: string;

  @ApiProperty({ example: 'users/user-1/photos/file-1/poster.jpg' })
  @IsString()
  @IsNotEmpty()
  posterKey: string;

  @ApiProperty({ example: 'users/user-1/photos/file-1/preview.gif' })
  @IsString()
  @IsNotEmpty()
  previewGifKey: string;

  @ApiProperty({ example: 45 })
  @IsInt()
  @IsPositive()
  duration: number;

  @ApiProperty({ example: 1920 })
  @IsInt()
  @IsPositive()
  width: number;

  @ApiProperty({ example: 1080 })
  @IsInt()
  @IsPositive()
  height: number;
}
