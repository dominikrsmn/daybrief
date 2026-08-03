import type {
  WhatsAppAudioMessage,
  WhatsAppWebhookPayload,
} from './whatsapp-webhook.types';

export interface WhatsAppDeliveryStatus {
  messageId: string;
  status: 'delivered' | 'read';
  timestamp?: string;
}

export interface UnknownWhatsAppWebhookEvent {
  field?: string;
  messageType?: string;
  status?: string;
}

export interface ClassifiedWhatsAppWebhook {
  audioMessages: WhatsAppAudioMessage[];
  deliveryStatuses: WhatsAppDeliveryStatus[];
  unknownEvents: UnknownWhatsAppWebhookEvent[];
}

/**
 * Classifies webhook content using Meta's explicit message type and status
 * fields. Unsupported or incomplete content remains observable without
 * logging the full payload or personal recipient information.
 */
export function classifyWhatsAppWebhook(
  payload: WhatsAppWebhookPayload,
): ClassifiedWhatsAppWebhook {
  const classified: ClassifiedWhatsAppWebhook = {
    audioMessages: [],
    deliveryStatuses: [],
    unknownEvents: [],
  };

  if (payload.object !== 'whatsapp_business_account') {
    classified.unknownEvents.push({});
    return classified;
  }

  let foundChange = false;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      foundChange = true;

      if (change.field !== 'messages') {
        classified.unknownEvents.push({ field: change.field });
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
          classified.unknownEvents.push({
            field: change.field,
            messageType: message.type,
          });
          continue;
        }

        classified.audioMessages.push({
          from: message.from,
          id: message.id,
          mediaId: message.audio.id,
          mimeType: message.audio.mime_type,
          phoneNumberId,
          timestamp: message.timestamp,
          voice: message.audio.voice === true,
        });
      }

      for (const status of change.value?.statuses ?? []) {
        if (
          status.id &&
          (status.status === 'delivered' || status.status === 'read')
        ) {
          classified.deliveryStatuses.push({
            messageId: status.id,
            status: status.status,
            timestamp: status.timestamp,
          });
          continue;
        }

        classified.unknownEvents.push({
          field: change.field,
          status: status.status,
        });
      }

      const value = change.value;
      if (
        (value?.messages?.length ?? 0) === 0 &&
        (value?.statuses?.length ?? 0) === 0
      ) {
        classified.unknownEvents.push({ field: change.field });
      }
    }
  }

  if (!foundChange) {
    classified.unknownEvents.push({});
  }

  return classified;
}
