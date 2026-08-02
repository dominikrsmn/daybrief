import { registerAs } from '@nestjs/config';

export const whatsappConfig = registerAs('whatsapp', () => {
  const appSecret = process.env.WHATSAPP_APP_SECRET ?? '';
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? '';

  if (process.env.NODE_ENV === 'production') {
    const missingVariables = [
      ['WHATSAPP_APP_SECRET', appSecret],
      ['WHATSAPP_WEBHOOK_VERIFY_TOKEN', verifyToken],
    ]
      .filter(([, value]) => value.length === 0)
      .map(([name]) => name);

    if (missingVariables.length > 0) {
      throw new Error(
        `Missing required WhatsApp configuration: ${missingVariables.join(', ')}`,
      );
    }
  }

  return { appSecret, verifyToken };
});
