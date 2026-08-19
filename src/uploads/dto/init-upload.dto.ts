import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';

export class InitUploadDto {
  @ApiProperty({ example: 'IMG_1234.jpg' })
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @ApiProperty({ example: 4829382 })
  @IsInt()
  @IsPositive()
  size: number;

  @ApiPropertyOptional({
    description: 'Optional event to attach this upload to',
    example: 'cm8x2abc...',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  eventId?: string;
}