import path from "node:path";
import { readFile } from "node:fs/promises";

import { HeadObjectCommand, S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

function trimTrailingSlash(value = "") {
  return String(value || "").replace(/\/+$/, "");
}

export function getObjectStorageConfig(env = process.env) {
  const endpoint = trimTrailingSlash(env.S3_ENDPOINT || "");
  const bucket = String(env.S3_BUCKET || "").trim();
  const accessKeyId = String(env.S3_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(env.S3_SECRET_ACCESS_KEY || "").trim();
  const publicBaseUrl = trimTrailingSlash(env.S3_PUBLIC_BASE_URL || "");
  const region = String(env.S3_REGION || "us-east-1").trim() || "us-east-1";
  const forcePathStyle = String(env.S3_FORCE_PATH_STYLE || "true").trim() !== "false";
  const assetPublicMode = String(env.ASSET_PUBLIC_MODE || "local").trim().toLowerCase();

  return {
    enabled: Boolean(endpoint && bucket && accessKeyId && secretAccessKey),
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region,
    forcePathStyle,
    publicBaseUrl: publicBaseUrl || (endpoint && bucket ? `${endpoint}/${bucket}` : ""),
    assetPublicMode,
  };
}

export function shouldUseS3PublicUrls(env = process.env) {
  const config = getObjectStorageConfig(env);
  return config.assetPublicMode === "s3" && Boolean(config.publicBaseUrl);
}

export function buildObjectStoragePublicUrl(key, env = process.env) {
  const config = getObjectStorageConfig(env);
  if (!config.publicBaseUrl) return null;
  return `${config.publicBaseUrl}/${String(key || "").replace(/^\/+/, "")}`;
}

export function buildStorageKey(prefix, fileName) {
  return `${String(prefix || "").replace(/^\/+|\/+$/g, "")}/${path.basename(String(fileName || ""))}`;
}

export function createObjectStorageClient(env = process.env) {
  const config = getObjectStorageConfig(env);
  if (!config.enabled) return null;

  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  async function uploadBuffer(body, key, contentType, cacheControl) {
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: String(key || "").replace(/^\/+/, ""),
        Body: body,
        ContentType: contentType || undefined,
        CacheControl: cacheControl || undefined,
      }),
    );

    return buildObjectStoragePublicUrl(key, env);
  }

  async function objectExists(key) {
    try {
      await client.send(
        new HeadObjectCommand({
          Bucket: config.bucket,
          Key: String(key || "").replace(/^\/+/, ""),
        }),
      );
      return true;
    } catch (error) {
      const statusCode = error?.$metadata?.httpStatusCode;
      const name = String(error?.name || "");

      if (statusCode === 404 || name === "NotFound" || name === "NoSuchKey") {
        return false;
      }

      throw error;
    }
  }

  async function uploadFile(localPath, key, contentType, cacheControl) {
    return uploadBuffer(await readFile(localPath), key, contentType, cacheControl);
  }

  return { config, objectExists, uploadBuffer, uploadFile };
}
