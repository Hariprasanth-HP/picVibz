import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';

@ApiTags('Events')
@Controller('events')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new event' })
  create(@Body() dto: CreateEventDto, @Request() req: any) {
    return this.events.create(dto, req.user.id);
  }

  @Get()
  @ApiOperation({ summary: 'List all events for the current user' })
  findAll(@Request() req: any) {
    return this.events.findAll(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single event by ID' })
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.events.findOne(id, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an event' })
  update(@Param('id') id: string, @Body() dto: UpdateEventDto, @Request() req: any) {
    return this.events.update(id, dto, req.user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an event' })
  remove(@Param('id') id: string, @Request() req: any) {
    return this.events.remove(id, req.user.id);
  }
}
