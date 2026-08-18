import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({ example: 'newPassword456' })
  @IsString()
  @MinLength(6)
  newPassword: string;
}