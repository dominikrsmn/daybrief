import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { briefingScheduleConfig } from './briefing-schedule.config';
import { ScheduledBriefingRepository } from './scheduled-briefing.repository';

@Module({
  imports: [ConfigModule.forFeature(briefingScheduleConfig), DatabaseModule],
  providers: [ScheduledBriefingRepository],
  exports: [ConfigModule, ScheduledBriefingRepository],
})
export class SchedulingModule {}
