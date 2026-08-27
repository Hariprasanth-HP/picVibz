import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { InternalApiGuard } from '../common/guards/internal-api.guard';
import { UploadsService } from './uploads.service';
import { InitUploadDto } from './dto/init-upload.dto';
import { VideoCompleteDto } from './dto/video-process.dto';

@ApiTags('Uploads')
@Controller('uploads')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('init')
  @ApiOperation({ summary: 'Initialize a direct-to-storage upload' })
  init(@Body() dto: InitUploadDto, @Request() req: any) {
    return this.uploads.init(req.user.id, dto);
  }

  @Post(':uploadId/complete')
  @ApiOperation({ summary: 'Complete an upload and enqueue processing' })
  complete(@Param('uploadId', ParseUUIDPipe) uploadId: string, @Request() req: any) {
    return this.uploads.complete(req.user.id, uploadId);
  }

  @Patch('internal/:id/complete')
  @UseGuards(InternalApiGuard)
  @ApiOperation({ summary: 'Internal: Complete video processing from worker' })
  completeFromWorker(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VideoCompleteDto) {
    return this.uploads.completeFromWorker(id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List the current user media' })
  findAll(@Request() req: any) {
    return this.uploads.findAll(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single media record with signed URLs' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.uploads.findOne(req.user.id, id);
  }
}
