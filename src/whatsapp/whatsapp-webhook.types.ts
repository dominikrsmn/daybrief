export interface WhatsAppMessageReference {
  from: string;
  id: string;
  phoneNumberId: string;
}

export interface WhatsAppAudioMessage extends WhatsAppMessageReference {
  mediaId: string;
  mimeType?: string;
  timestamp?: string;
  voice: boolean;
}

export interface WhatsAppTextMessage extends WhatsAppMessageReference {
  body: string;
  contextMessageId?: string;
  timestamp?: string;
}

interface WhatsAppWebhookAudio {
  id?: string;
  mime_type?: string;
  voice?: boolean;
}

interface WhatsAppWebhookMessage {
  audio?: WhatsAppWebhookAudio;
  context?: {
    id?: string;
  };
  from?: string;
  id?: string;
  timestamp?: string;
  text?: {
    body?: string;
  };
  type?: string;
}

interface WhatsAppWebhookStatus {
  id?: string;
  status?: string;
  timestamp?: string;
}

interface WhatsAppWebhookValue {
  messages?: WhatsAppWebhookMessage[];
  metadata?: {
    phone_number_id?: string;
  };
  statuses?: WhatsAppWebhookStatus[];
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
