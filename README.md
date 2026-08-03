<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ pnpm install
```

## Compile and run the project

```bash
# development
$ pnpm run start

# watch mode
$ pnpm run start:dev

# production mode
$ pnpm run start:prod
```

## Run tests

```bash
# unit tests
$ pnpm run test

# e2e tests
$ pnpm run test:e2e

# test coverage
$ pnpm run test:cov
```

## Deployment

### Coolify (Dockerfile)

Create a new application in Coolify, connect this repository, and select
**Dockerfile** as the build pack. Keep the Dockerfile location as `/Dockerfile`
and set the exposed port to `3000`.

Add these environment variables in Coolify:

```bash
NODE_ENV=production
PORT=3000
OPENAI_API_KEY=your-api-key
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe
OPENAI_BRIEFING_MODEL=gpt-5.6
WHATSAPP_WEBHOOK_VERIFY_TOKEN=your-verify-token
WHATSAPP_APP_SECRET=your-app-secret
WHATSAPP_ACCESS_TOKEN=your-system-user-access-token
WHATSAPP_GRAPH_API_VERSION=vXX.X
```

Do not commit secrets or pass them as Docker build arguments. Coolify injects the
variables at runtime. The container runs as an unprivileged user and exposes
`GET /health` for health checks. Configure Coolify's health-check path as
`/health`; the Docker image also includes its own health check.

To build and test the production image locally:

```bash
docker build -t daybrief .
docker run --rm -p 3000:3000 --env-file .env daybrief
curl http://localhost:3000/health
```

### WhatsApp Cloud API webhook

The application accepts Meta's verification request and signed event deliveries
at this callback URL:

```text
https://YOUR-COOLIFY-DOMAIN/webhooks/whatsapp
```

In **Meta App Dashboard → WhatsApp → Configuration → Webhook**:

1. Set **Callback URL** to the URL above.
2. Set **Verify token** to the exact value configured as
   `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in Coolify.
3. Verify and save the callback.
4. Subscribe the WhatsApp Business Account to the `messages` webhook field.

Set `WHATSAPP_APP_SECRET` in Coolify to the app secret from **App settings →
Basic**. Meta signs event deliveries with this secret; unsigned or incorrectly
signed requests are rejected. Redeploy after changing Coolify environment
variables. `WHATSAPP_ACCESS_TOKEN` authorizes replies through the Cloud API;
prefer a system-user token rather than a temporary dashboard token. Set
`WHATSAPP_GRAPH_API_VERSION` to the Graph API version used by your Meta app.

When a user sends a voice message to the connected WhatsApp Cloud API number,
the app acknowledges Meta immediately, then downloads the audio, transcribes it,
creates the morning briefing, and replies to the original WhatsApp message with
the briefing text. Structured log events record each stage without logging the
audio, transcript, or briefing contents. Duplicate webhook deliveries are
suppressed in memory while processing and for 24 hours after successful
processing. Failed attempts are not retained in the duplicate cache.

You can verify the callback challenge after deployment:

```bash
curl --get "https://YOUR-COOLIFY-DOMAIN/webhooks/whatsapp" \
  --data-urlencode "hub.mode=subscribe" \
  --data-urlencode "hub.verify_token=YOUR_VERIFY_TOKEN" \
  --data-urlencode "hub.challenge=daybrief-test"
```

The response must be `daybrief-test`.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
