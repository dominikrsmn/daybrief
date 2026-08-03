import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { OPENAI_CLIENT } from '../src/openai/openai.provider';
import { createHmac } from 'node:crypto';
import { configureStaticPages } from '../src/static-pages';

describe('AppController (e2e)', () => {
  let app: NestExpressApplication;
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
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'test-verify-token';
    process.env.WHATSAPP_APP_SECRET = 'test-app-secret';

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

    app = moduleFixture.createNestApplication<NestExpressApplication>({
      rawBody: true,
    });
    configureStaticPages(app);
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('/privacy (GET)', () => {
    return request(app.getHttpServer())
      .get('/privacy')
      .expect('Content-Type', /text\/html/)
      .expect(200)
      .expect((response: { text: string }) => {
        expect(response.text).toContain('Daybrief Privacy Policy');
      });
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

  it('/webhooks/whatsapp (GET) completes Meta webhook verification', () => {
    return request(app.getHttpServer())
      .get('/webhooks/whatsapp')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'test-verify-token',
        'hub.challenge': 'challenge-123',
      })
      .expect(200)
      .expect('challenge-123');
  });

  it('/webhooks/whatsapp (GET) rejects an invalid verify token', () => {
    return request(app.getHttpServer())
      .get('/webhooks/whatsapp')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong-token',
        'hub.challenge': 'challenge-123',
      })
      .expect(403);
  });

  it('/webhooks/whatsapp (POST) accepts an incoming voice message', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'phone-number-id' },
                messages: [
                  {
                    from: '4917648095385',
                    id: 'message-id',
                    timestamp: '1785686400',
                    type: 'audio',
                    audio: {
                      id: 'media-id',
                      mime_type: 'audio/ogg; codecs=opus',
                      voice: true,
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const signature = `sha256=${createHmac('sha256', 'test-app-secret')
      .update(JSON.stringify(payload))
      .digest('hex')}`;

    return request(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .set('x-hub-signature-256', signature)
      .send(payload)
      .expect(200)
      .expect({ received: true });
  });

  it('/webhooks/whatsapp (POST) rejects an invalid signature', () => {
    return request(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .set('x-hub-signature-256', 'sha256=invalid')
      .send({ object: 'whatsapp_business_account', entry: [] })
      .expect(401);
  });

  afterEach(async () => {
    await app.close();
    delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    delete process.env.WHATSAPP_APP_SECRET;
  });
});
