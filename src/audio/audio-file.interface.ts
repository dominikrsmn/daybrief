export const MAX_AUDIO_FILE_SIZE_BYTES = 25 * 1024 * 1024;

export interface UploadedAudioFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}
