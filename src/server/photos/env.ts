import type { PhotoJob } from "./contracts.js";

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  PHOTO_QUEUE: Queue<PhotoJob>;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  AUTH_JWKS_URL: string;
  AUTH_ISSUER: string;
  AUTH_AUDIENCE: string;
  MEDIA_SERVICE_URL: string;
  MEDIA_SERVICE_TOKEN: string;
  PAYOUT_KEY_ENCRYPTION_KEY?: string;
  WEBHOOK_SECRET?: string;
  ASAAS_API_KEY?: string;
  ASAAS_BASE_URL?: string;
}
