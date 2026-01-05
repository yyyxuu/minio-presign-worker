// index.js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== "/presignedUrl") {
      return new Response("Not Found", { status: 404 });
    }

    const filename = url.searchParams.get("filename");
    if (!filename) {
      return new Response(JSON.stringify({
        error: "Missing filename parameter"
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 添加随机后缀避免文件名冲突，不保留原文件名和路径
    const dateNow = new Date();
    // 转换为 GMT+8 时区
    const offset = 8 * 60; // GMT+8 的分钟偏移量
    const localTime = new Date(dateNow.getTime() + (dateNow.getTimezoneOffset() + offset) * 60000);
    const timestamp = localTime.toISOString().replace('T', ' ').substring(0, 19);
    const uuid = crypto.randomUUID();

    // 提取文件扩展名
    const lastDotIndex = filename.lastIndexOf('.');
    const extension = lastDotIndex > 0 ? filename.substring(lastDotIndex) : '';

    // 使用时间戳+UUID作为文件名
    const modifiedFilename = `${timestamp}_${uuid}${extension}`;

    // 1. 构建公开访问 URL
    const useSSL = env.MINIO_USE_SSL === "true";
    const protocol = useSSL ? "https" : "http";
    const port = env.MINIO_PORT && !["80", "443"].includes(env.MINIO_PORT)
      ? `:${env.MINIO_PORT}`
      : "";
    const publicUrl = `${protocol}://${env.MINIO_ENDPOINT}${port}/${env.MINIO_BUCKET}/${encodeURIComponent(modifiedFilename)}`;

    // 3. 生成预签名上传 URL
    const expirySeconds = 60 * 5; // 5分钟有效期
    const now = Math.floor(Date.now() / 1000);
    const expires = now + expirySeconds;

    try {
      const uploadUrl = await generatePresignedUrl(
        env,
        modifiedFilename,
        expires
      );

      return new Response(JSON.stringify({
        upload_url: uploadUrl,
        public_url: publicUrl
      }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    } catch (err) {
      return new Response(JSON.stringify({
        error: "Failed to generate presigned URL",
        details: err.message
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
};

async function generatePresignedUrl(env, filename, expires) {
  const useSSL = env.MINIO_USE_SSL === "true";
  const protocol = useSSL ? "https" : "http";
  const port = env.MINIO_PORT && !["80", "443"].includes(env.MINIO_PORT)
    ? `:${env.MINIO_PORT}`
    : "";

  // 1. 规范化文件名（处理路径分隔符）
  const encodedFilename = encodeURIComponent(filename)
    .replace(/%2F/g, '/');

  // 2. 生成时间戳
  function formatISO8601(date) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');

    return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
  }

  const timestamp = formatISO8601(new Date());
  const dateStamp = timestamp.substring(0, 8); // YYYYMMDD

  // 3. 构建规范请求
  const canonicalUri = `/${env.MINIO_BUCKET}/${encodedFilename}`;

  const region = env.MINIO_REGION || "us-east-1";
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;

  // 计算过期时间（秒）
  const now = Math.floor(Date.now() / 1000);
  const expiresInSeconds = String(expires - now);

  // 构建查询参数（用于签名和最终 URL）
  const queryParams = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${env.MINIO_ACCESS_KEY}/${credentialScope}`,
    "X-Amz-Date": timestamp,
    "X-Amz-Expires": expiresInSeconds,
    "X-Amz-SignedHeaders": "host"
  };

  // 构建规范查询字符串（按 key 排序，URL 编码）
  const canonicalQueryString = Object.keys(queryParams)
    .sort()
    .map(key => {
      const encodedKey = encodeURIComponent(key);
      const encodedValue = encodeURIComponent(queryParams[key]);
      return `${encodedKey}=${encodedValue}`;
    })
    .join('&');

  const headers = {
    "host": `${env.MINIO_ENDPOINT}${port}`
  };

  const sortedHeaders = Object.keys(headers)
    .map(key => key.toLowerCase())
    .sort((a, b) => a.localeCompare(b))
    .map(key => `${key}:${headers[key]}`)
    .join("\n");

  const signedHeaders = Object.keys(headers)
    .map(key => key.toLowerCase())
    .sort()
    .join(";");

  const canonicalRequest = [
    "PUT",                      // HTTP 方法
    canonicalUri,               // 规范 URI
    canonicalQueryString,       // 规范查询参数
    sortedHeaders,              // 规范 headers
    "",                         // 空行
    signedHeaders,              // 签名 headers
    "UNSIGNED-PAYLOAD"          // 有效负载哈希
  ].join("\n");

  // 4. 创建签名
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    timestamp,
    credentialScope,
    await sha256(canonicalRequest)
  ].join("\n");

  const signature = (await getSignature(
    env.MINIO_SECRET_KEY,
    dateStamp,
    stringToSign,
    region
  )).toLowerCase();

  // 构建最终 URL
  const base = `${protocol}://${env.MINIO_ENDPOINT}${port}${canonicalUri}`;

  const queryString = Object.entries(queryParams)
    .map(([key, value]) => {
      return `${key}=${encodeURIComponent(value)}`;
    })
    .join('&');

  const signatureParam = `X-Amz-Signature=${signature}`;
  const fullUrl = `${base}?${queryString}&${signatureParam}`;

  return fullUrl;
}

// AWS 签名 V4 辅助函数
async function getSignature(secretKey, dateStamp, stringToSign, region = "us-east-1") {
  const kDate = await hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, "s3");
  const kSigning = await hmac(kService, "aws4_request");
  return await hmac(kSigning, stringToSign, true);
}

// SHA256 哈希
async function sha256(message) {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .toLowerCase();
}

// HMAC-SHA256
async function hmac(key, message, hexOutput = false) {
  const encoder = new TextEncoder();
  let keyBuffer;

  if (typeof key === "string") {
    keyBuffer = encoder.encode(key);
  } else {
    keyBuffer = key;
  }

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(message)
  );

  const uint8Array = new Uint8Array(signature);
  if (hexOutput) {
    return Array.from(uint8Array)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .toLowerCase();
  }
  return uint8Array;
}