import path from "node:path";
import { readFile } from "node:fs/promises";

import {
  DeleteObjectsCommand,
  GetBucketCorsCommand,
  GetBucketLifecycleConfigurationCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutBucketLifecycleConfigurationCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";

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
  const forcePathStyle =
    String(env.S3_FORCE_PATH_STYLE || "true").trim() !== "false";
  const assetPublicMode = String(env.ASSET_PUBLIC_MODE || "local")
    .trim()
    .toLowerCase();

  return {
    enabled: Boolean(endpoint && bucket && accessKeyId && secretAccessKey),
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region,
    forcePathStyle,
    publicBaseUrl:
      publicBaseUrl || (endpoint && bucket ? `${endpoint}/${bucket}` : ""),
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

async function ensureExpirationLifecycleRule(
  client,
  config,
  { id, prefix, days },
) {
  let currentRules = [];
  try {
    const current = await client.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: config.bucket }),
    );
    currentRules = Array.isArray(current?.Rules) ? current.Rules : [];
  } catch (error) {
    const statusCode = error?.$metadata?.httpStatusCode;
    const name = String(error?.name || "");
    if (statusCode !== 404 && name !== "NoSuchLifecycleConfiguration")
      throw error;
  }

  const nextRule = {
    ID: String(id),
    Status: "Enabled",
    Filter: { Prefix: String(prefix || "") },
    Expiration: { Days: Math.max(1, Number(days) || 1) },
  };
  await client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: config.bucket,
      LifecycleConfiguration: {
        Rules: [
          ...currentRules.filter((rule) => rule?.ID !== nextRule.ID),
          nextRule,
        ],
      },
    }),
  );
  return nextRule;
}

async function ensureCorsRule(client, config, { id, allowedOrigins }) {
  let currentRules = [];
  try {
    const current = await client.send(
      new GetBucketCorsCommand({ Bucket: config.bucket }),
    );
    currentRules = Array.isArray(current?.CORSRules) ? current.CORSRules : [];
  } catch (error) {
    const statusCode = error?.$metadata?.httpStatusCode;
    const name = String(error?.name || "");
    if (statusCode !== 404 && name !== "NoSuchCORSConfiguration") throw error;
  }

  const nextRule = {
    ID: String(id),
    AllowedOrigins: Array.from(
      new Set(
        allowedOrigins
          .map(String)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ),
    AllowedMethods: ["GET", "HEAD", "POST", "PUT"],
    AllowedHeaders: ["content-type", "x-amz-*"],
    ExposeHeaders: ["ETag"],
    MaxAgeSeconds: 3_600,
  };
  await client.send(
    new PutBucketCorsCommand({
      Bucket: config.bucket,
      CORSConfiguration: {
        CORSRules: [
          ...currentRules.filter((rule) => rule?.ID !== nextRule.ID),
          nextRule,
        ],
      },
    }),
  );
  return nextRule;
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

  async function headObject(key) {
    return await client.send(
      new HeadObjectCommand({
        Bucket: config.bucket,
        Key: String(key || "").replace(/^\/+/, ""),
      }),
    );
  }

  async function createPresignedUploadUrl(
    key,
    contentType,
    { expiresIn = 600 } = {},
  ) {
    return await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: String(key || "").replace(/^\/+/, ""),
        ContentType: contentType || undefined,
      }),
      { expiresIn },
    );
  }

  async function createPresignedPostUpload(
    key,
    contentType,
    { expiresIn = 600, minBytes = 1, maxBytes } = {},
  ) {
    const normalizedKey = String(key || "").replace(/^\/+/, "");
    return await createPresignedPost(client, {
      Bucket: config.bucket,
      Key: normalizedKey,
      Expires: expiresIn,
      Fields: { "Content-Type": contentType },
      Conditions: [
        ["eq", "$key", normalizedKey],
        ["eq", "$Content-Type", contentType],
        ["content-length-range", minBytes, maxBytes],
      ],
    });
  }

  async function createPresignedDownloadUrl(key, { expiresIn = 900 } = {}) {
    return await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: String(key || "").replace(/^\/+/, ""),
      }),
      { expiresIn },
    );
  }

  async function deleteObjects(keys = []) {
    const normalizedKeys = Array.from(
      new Set(
        keys
          .map((key) => String(key || "").replace(/^\/+/, ""))
          .filter(Boolean),
      ),
    );

    for (let offset = 0; offset < normalizedKeys.length; offset += 1_000) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: config.bucket,
          Delete: {
            Quiet: true,
            Objects: normalizedKeys
              .slice(offset, offset + 1_000)
              .map((Key) => ({ Key })),
          },
        }),
      );
    }

    return normalizedKeys.length;
  }

  async function uploadFile(localPath, key, contentType, cacheControl) {
    return uploadBuffer(
      await readFile(localPath),
      key,
      contentType,
      cacheControl,
    );
  }

  return {
    config,
    createPresignedDownloadUrl,
    createPresignedPostUpload,
    createPresignedUploadUrl,
    deleteObjects,
    ensureCorsRule: (input) => ensureCorsRule(client, config, input),
    ensureExpirationLifecycleRule: (input) =>
      ensureExpirationLifecycleRule(client, config, input),
    headObject,
    objectExists,
    uploadBuffer,
    uploadFile,
  };
}
