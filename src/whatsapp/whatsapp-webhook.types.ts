export interface WhatsAppAudioMessage {
  from: string;
  id: string;
  mediaId: string;
  mimeType?: string;
  phoneNumberId?: string;
  timestamp?: string;
  voice: boolean;
}

interface WhatsAppWebhookAudio {
  id?: string;
  mime_type?: string;
  voice?: boolean;
}

interface WhatsAppWebhookMessage {
  audio?: WhatsAppWebhookAudio;
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
}

interface WhatsAppWebhookValue {
  messages?: WhatsAppWebhookMessage[];
  metadata?: {
    phone_number_id?: string;
  };
}

interface WhatsAppWebhookChange {
  field?: string;
  value?: WhatsAppWebhookValue;
}

interface WhatsAppWebhookEntry {
  changes?: WhatsAppWebhookChange[];
}

export interface WhatsAppWebhookPayload {
  entry?: WhatsAppWebhookEntry[];
  object?: string;
}
