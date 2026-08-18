import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  Request,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PhotosService } from './photos.service';

@ApiTags('Photos')
@Controller('events/:eventId/photos')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PhotosController {
  constructor(private readonly photos: PhotosService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload a photo to an event' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  upload(
    @Param('eventId') eventId: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req: any,
  ) {
    return this.photos.upload(eventId, file, req.user.id);
  }

  @Get()
  @ApiOperation({ summary: 'List all photos for an event' })
  findAll(@Param('eventId') eventId: string, @Request() req: any) {
    return this.photos.findByEvent(eventId, req.user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a photo from an event' })
  remove(
    @Param('eventId') eventId: string,
    @Param('id') id: string,
    @Request() req: any,
  ) {
    return this.photos.remove(eventId, id, req.user.id);
  }
}
