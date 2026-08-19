export interface MediaProcessInput {
  userId: string;
  fileId: string;
  original: Buffer;
  mimeType: string;
}

export interface MediaProcessResult {
  mediumKey: string | null;
  previewKey: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
}