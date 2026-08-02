import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AudioModule } from './audio/audio.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), AudioModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
