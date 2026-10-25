import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { UPLOAD_TTL_SECONDS } from "./contracts.js";
import type { Env } from "./env.js";

export async function signUpload(env: Env, key: string, size: number): Promise<string> {
  const client = new S3Client({
    region: "auto", endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    // R2: não enviar checksums opcionais específicos do S3.
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  return getSignedUrl(client, new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME, Key: key, ContentType: "image/jpeg", ContentLength: size,
  }), {
    expiresIn: UPLOAD_TTL_SECONDS,
    signableHeaders: new Set(["content-type", "content-length"]),
  });
}
