# MinIO 预签名 URL Worker

[English](README_EN.md) | 简体中文

一个基于 Cloudflare Worker 的 MinIO 对象存储预签名 URL 生成器，使用 AWS Signature Version 4 认证。该 Worker 创建具有自动文件名冲突防护功能的限时（5 分钟）上传 URL。

## 特性

- **AWS Signature V4 认证**：完全兼容 AWS S3 Signature Version 4
- **文件名冲突防护**：使用 GMT+8 时区时间戳和 UUID 自动生成唯一文件名
- **支持 CORS**：可直接用于跨域请求
- **5 分钟有效期**：限时上传 URL 保障安全性
- **简单 API**：单一接口，仅需文件名参数

## 前置要求

- Node.js 和 npm
- Cloudflare Workers 账号
- MinIO 服务器（或任何 S3 兼容存储）

## 安装

1. 克隆仓库：
```bash
git clone <your-repo-url>
cd minio-presign-worker
```

2. 安装依赖：
```bash
npm install
```

## 配置

创建 `.dev.vars` 文件用于本地开发：

```bash
MINIO_ENDPOINT=your-minio-server.com
MINIO_PORT=9000
MINIO_BUCKET=your-bucket-name
MINIO_ACCESS_KEY=your-access-key
MINIO_SECRET_KEY=your-secret-key
MINIO_USE_SSL=false
MINIO_REGION=us-east-1
```

### 环境变量

| 变量 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `MINIO_ENDPOINT` | 是 | - | MinIO 服务器地址 |
| `MINIO_BUCKET` | 是 | - | 目标存储桶名称 |
| `MINIO_ACCESS_KEY` | 是 | - | MinIO 访问密钥 |
| `MINIO_SECRET_KEY` | 是 | - | MinIO 秘密密钥（应配置为加密密钥） |
| `MINIO_PORT` | 否 | 9000 | 服务器端口（80 或 443 时从 URL 中省略） |
| `MINIO_USE_SSL` | 否 | false | 启用 SSL (`true`/`false`) |
| `MINIO_REGION` | 否 | us-east-1 | 用于签名的 AWS 区域 |

### 生产环境加密密钥

生产环境中，敏感值必须设置为加密密钥：

```bash
wrangler secret put MINIO_ACCESS_KEY
wrangler secret put MINIO_SECRET_KEY
```

其他环境变量可在 `wrangler.jsonc` 中配置或通过 Cloudflare 控制台设置。

## 开发

### 本地开发

```bash
npm run dev
# 或
npm start
```

Worker 将使用 `.dev.vars` 中的配置与加密密钥合并后的配置运行。

### 测试

```bash
npm test
```

测试使用 Vitest 和 `@cloudflare/vitest-pool-workers` 进行 Cloudflare Workers 模拟。测试环境会自动读取 `.dev.vars` 配置。

## 部署

部署到 Cloudflare Workers：

```bash
npm run deploy
```

## 使用方法

### API 接口

**POST** `/presignedUrl?filename=<filename>`

#### 查询参数

- `filename`（必需）：期望的文件名（会被修改以防止冲突）

#### 响应

```json
{
  "upload_url": "https://minio-server.com/bucket/timestamp-uuid.ext?X-Amz-Algorithm=...",
  "public_url": "https://minio-server.com/bucket/timestamp-uuid.ext"
}
```

#### 使用示例

```bash
curl "https://your-worker.workers.dev/presignedUrl?filename=test.jpg"
```

响应：
```json
{
  "upload_url": "https://minio.example.com:9000/my-bucket/2025-01-05 12:34:56_a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=...&X-Amz-Date=20250105T043456Z&X-Amz-Expires=300&X-Amz-SignedHeaders=host&X-Amz-Signature=...",
  "public_url": "https://minio.example.com:9000/my-bucket/2025-01-05 12:34:56_a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg"
}
```

### 上传文件

使用返回的 `upload_url` 上传文件：

```bash
curl -X PUT -H "Content-Type: image/jpeg" \
  --data-binary @/path/to/your/file.jpg \
  "https://minio.example.com:9000/my-bucket/2025-01-05 12:34:56_a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg?X-Amz-Algorithm=..."
```

上传成功后，文件可通过 `public_url` 访问（如果 MinIO 存储桶配置为公开可读）。

## 工作原理

### 文件名转换

Worker 通过以下方式自动防止文件名冲突：

1. 从原始文件名中提取文件扩展名
2. 使用以下信息生成唯一标识符：
   - GMT+8 时区的当前时间戳（格式：`YYYY-MM-DD HH:MM:SS`）
   - 随机 UUID
3. 组合为：`{timestamp}_{uuid}.{extension}`

示例：
- 输入：`photo.jpg`
- 存储为：`2025-01-05 12:34:56_a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg`

### AWS Signature V4 流程

Worker 实现了 AWS Signature Version 4 签名：

1. **规范请求**：HTTP 方法、URI、查询参数、请求头和负载哈希
2. **待签名字符串**：算法、时间戳、凭证范围和规范请求哈希
3. **签名密钥派生**：HMAC 链（kDate → kRegion → kService → kSigning）
4. **签名**：使用派生的签名密钥对待签名字符串进行 HMAC
5. **最终 URL**：包含 X-Amz-* 查询参数（包括签名）的基础 URL

## 错误响应

所有错误均返回包含 `error` 字段的 JSON：

- **400 Bad Request**：缺少文件名参数
  ```json
  {
    "error": "Missing filename parameter"
  }
  ```

- **404 Not Found**：无效路径（仅 `/presignedUrl` 有效）

- **500 Internal Server Error**：生成预签名 URL 失败
  ```json
  {
    "error": "Failed to generate presigned URL",
    "details": "Error message"
  }
  ```

## 架构

### 项目结构

```
minio-presign-worker/
├── src/
│   └── index.js          # Worker 主入口文件
├── public/
│   └── index.html        # 静态演示页面
├── test/
│   └── index.spec.js     # 测试文件
├── .dev.vars             # 本地开发环境配置（不提交到 git）
├── wrangler.jsonc        # Cloudflare Workers 配置
├── package.json          # 依赖和脚本
└── README.md             # 本文件
```

### 核心函数

- **`generatePresignedUrl(env, filename, expires)`**：生成带 AWS SigV4 的预签名上传 URL
- **`sha256(message)`**：使用 Web Crypto API 的 SHA-256 哈希
- **`hmac(key, message, hexOutput)`**：HMAC-SHA256 签名
- **`getSignature(secretKey, dateStamp, stringToSign, region)`**：AWS SigV4 签名链

## 浏览器示例

```javascript
async function uploadFile(file) {
  // 1. 获取预签名 URL
  const response = await fetch(
    `https://your-worker.workers.dev/presignedUrl?filename=${encodeURIComponent(file.name)}`
  );
  const { upload_url, public_url } = await response.json();

  // 2. 直接上传文件到 MinIO
  await fetch(upload_url, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': file.type
    }
  });

  // 3. 文件现在可通过 public_url 访问
  console.log('文件已上传:', public_url);
  return public_url;
}

// 使用方法
const fileInput = document.querySelector('#file-input');
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  const url = await uploadFile(file);
  console.log('已上传到:', url);
});
```

## 许可证

MIT

## 贡献

欢迎贡献！请随时提交 Pull Request。
