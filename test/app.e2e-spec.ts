import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OPENAI_CLIENT } from './../src/openai/openai.provider';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  const createTranscription = jest.fn().mockResolvedValue({
    text: 'Transcribed audio',
  });
  const briefing = {
    text: '# Morning briefing\n\n## Priority focus\n\n- Prepare the report.',
    wakeupTime: '07:00',
    uncertainties: ['The report deadline was not stated.'],
  };
  const createBriefing = jest.fn().mockResolvedValue({
    output_parsed: briefing,
  });

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(OPENAI_CLIENT)
      .useValue({
        audio: {
          transcriptions: {
            create: createTranscription,
          },
        },
        responses: {
          parse: createBriefing,
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('/audio (POST) accepts a multipart audio file', () => {
    return request(app.getHttpServer())
      .post('/audio')
      .attach('audio', Buffer.from('test audio'), {
        filename: 'recording.mp3',
        contentType: 'audio/mpeg',
      })
      .expect(201)
      .expect(briefing);
  });

  it('/audio (POST) rejects requests without an audio file', () => {
    return request(app.getHttpServer())
      .post('/audio')
      .field('title', 'Missing audio')
      .expect(400)
      .expect((response: { body: unknown }) => {
        const body = response.body as { message: string };

        expect(body.message).toBe(
          'An audio file is required in the "audio" multipart field.',
        );
      });
  });

  it('/audio (POST) rejects non-audio files', () => {
    return request(app.getHttpServer())
      .post('/audio')
      .attach('audio', Buffer.from('plain text'), {
        filename: 'notes.txt',
        contentType: 'text/plain',
      })
      .expect(415);
  });

  afterEach(async () => {
    await app.close();
  });
});
