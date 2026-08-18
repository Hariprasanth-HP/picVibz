import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GoogleLoginDto {
  @ApiProperty({ example: 'ya29.a0...' })
  @IsString()
  accessToken: string;
}
