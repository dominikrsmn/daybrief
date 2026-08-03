import { registerAs } from '@nestjs/config';

export const whatsappConfig = registerAs('whatsapp', () => {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN ?? '';
  const appSecret = process.env.WHATSAPP_APP_SECRET ?? '';
  const graphApiVersion = process.env.WHATSAPP_GRAPH_API_VERSION ?? '';
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? '';

  if (graphApiVersion && !/^v\d+\.\d+$/.test(graphApiVersion)) {
    throw new Error('WHATSAPP_GRAPH_API_VERSION must use the format "vXX.X".');
  }

  if (process.env.NODE_ENV === 'production') {
    const missingVariables = [
      ['WHATSAPP_ACCESS_TOKEN', accessToken],
      ['WHATSAPP_APP_SECRET', appSecret],
      ['WHATSAPP_GRAPH_API_VERSION', graphApiVersion],
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

  return { accessToken, appSecret, graphApiVersion, verifyToken };
});
