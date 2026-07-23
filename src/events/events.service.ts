import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateEventDto, userId: string) {
    return this.prisma.event.create({
      data: {
        name: dto.name,
        type: dto.type ?? 'Other',
        date: dto.date ?? 'TBD',
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        location: dto.location ?? 'TBD',
        coverImage: dto.coverImage ?? '',
        createdBy: userId,
      },
    });
  }

  findAll(userId: string) {
    return this.prisma.event.findMany({
      where: { createdBy: userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, userId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id, createdBy: userId },
    });
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  async update(id: string, dto: UpdateEventDto, userId: string) {
    await this.findOne(id, userId);
    return this.prisma.event.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.date !== undefined && { date: dto.date }),
        ...(dto.startDate !== undefined && { startDate: new Date(dto.startDate) }),
        ...(dto.endDate !== undefined && { endDate: new Date(dto.endDate) }),
        ...(dto.location !== undefined && { location: dto.location }),
        ...(dto.coverImage !== undefined && { coverImage: dto.coverImage }),
      },
    });
  }

  async remove(id: string, userId: string) {
    await this.findOne(id, userId);
    return this.prisma.event.delete({ where: { id } });
  }
}
