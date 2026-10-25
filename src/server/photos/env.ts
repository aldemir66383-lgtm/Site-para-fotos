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
  ASAAS_WEBHOOK_TOKEN?: string;
  FV_FACE_SEARCH?: string;
  FACE_MODEL_VERSION?: string;
  FACE_EMBEDDING_DIMENSIONS?: string;
  FACE_MEDIUM_THRESHOLD?: string;
  FACE_HIGH_THRESHOLD?: string;
  FACE_EMBEDDINGS_URL?: string;
  FACE_EMBEDDINGS_TOKEN?: string;
  FACE_INDEX_ENCRYPTION_KEY?: string;
  FACE_IP_HASH_SECRET?: string;
  FACE_CONSENT_RETENTION_DAYS?: string;
  PUBLIC_SITE_URL?: string;
  WHATSAPP_ENABLED?: string;
  WHATSAPP_GRAPH_VERSION?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_TEMPLATE_NAME?: string;
  WHATSAPP_TEMPLATE_LANGUAGE?: string;
}
