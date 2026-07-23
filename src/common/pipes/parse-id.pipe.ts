import { PipeTransform, Injectable, ArgumentMetadata, BadRequestException } from '@nestjs/common';

@Injectable()
export class ParseIdPipe implements PipeTransform<string, number> {
  transform(value: string, _metadata: ArgumentMetadata): number {
    const id = parseInt(value, 10);
    if (isNaN(id) || id <= 0) {
      throw new BadRequestException('Invalid ID — must be a positive integer');
    }
    return id;
  }
}
