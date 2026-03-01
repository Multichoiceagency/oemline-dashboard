import { Client } from "minio";
import { config } from "../config.js";
import { logger } from "./logger.js";

const BUCKET = config.MINIO_BUCKET;

export const minioClient = new Client({
  endPoint: config.MINIO_ENDPOINT,
  port: config.MINIO_PORT,
  useSSL: config.MINIO_USE_SSL === "true",
  accessKey: config.MINIO_ACCESS_KEY,
  secretKey: config.MINIO_SECRET_KEY,
});

/**
 * Ensure the bucket exists and has a public read policy for the images prefix.
 */
export async function ensureBucket(): Promise<void> {
  if (!config.MINIO_ACCESS_KEY) {
    logger.warn("MinIO not configured (no access key) — file uploads disabled");
    return;
  }

  try {
    const exists = await minioClient.bucketExists(BUCKET);
    if (!exists) {
      await minioClient.makeBucket(BUCKET, "eu-west-1");
      logger.info({ bucket: BUCKET }, "Created MinIO bucket");
    }

    // Set public read policy for images/
    const policy = {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { AWS: ["*"] },
          Action: ["s3:GetObject"],
          Resource: [`arn:aws:s3:::${BUCKET}/images/*`],
        },
      ],
    };
    await minioClient.setBucketPolicy(BUCKET, JSON.stringify(policy));
    logger.info({ bucket: BUCKET }, "MinIO bucket ready with public read policy");
  } catch (err) {
    logger.warn({ err }, "MinIO bucket setup failed — file uploads may not work");
  }
}

/**
 * Upload a file buffer to MinIO and return the public URL.
 */
export async function uploadFile(
  buffer: Buffer,
  objectName: string,
  contentType: string,
): Promise<string> {
  await minioClient.putObject(BUCKET, objectName, buffer, buffer.length, {
    "Content-Type": contentType,
  });
  return `${config.MINIO_PUBLIC_URL}/${BUCKET}/${objectName}`;
}

/**
 * Delete a file from MinIO.
 */
export async function deleteFile(objectName: string): Promise<void> {
  await minioClient.removeObject(BUCKET, objectName);
}

/**
 * Generate a presigned URL for direct upload (optional, for large files).
 */
export async function getPresignedUploadUrl(
  objectName: string,
  expirySeconds = 3600,
): Promise<string> {
  return minioClient.presignedPutObject(BUCKET, objectName, expirySeconds);
}
