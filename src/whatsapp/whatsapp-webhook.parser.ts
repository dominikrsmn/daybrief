import type {
  WhatsAppAudioMessage,
  WhatsAppWebhookPayload,
} from './whatsapp-webhook.types';

/**
 * Extracts complete audio-message references from a WhatsApp webhook payload.
 * Incomplete entries are ignored because they cannot complete the reply flow.
 */
export function extractWhatsAppAudioMessages(
  payload: WhatsAppWebhookPayload,
): WhatsAppAudioMessage[] {
  if (payload.object !== 'whatsapp_business_account') {
    return [];
  }

  const audioMessages: WhatsAppAudioMessage[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') {
        continue;
      }

      const phoneNumberId = change.value?.metadata?.phone_number_id;

      for (const message of change.value?.messages ?? []) {
        if (
          message.type !== 'audio' ||
          !message.audio?.id ||
          !message.from ||
          !message.id ||
          !phoneNumberId
        ) {
          continue;
        }

        audioMessages.push({
          from: message.from,
          id: message.id,
          mediaId: message.audio.id,
          mimeType: message.audio.mime_type,
          phoneNumberId,
          timestamp: message.timestamp,
          voice: message.audio.voice === true,
        });
      }
    }
  }

  return audioMessages;
}
