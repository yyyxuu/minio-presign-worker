# MinIO Presigned URL Worker

English | [简体中文](README.md)

A Cloudflare Worker that generates presigned URLs for MinIO object storage using AWS Signature Version 4 authentication. The worker creates time-limited (5-minute) upload URLs with automatic filename conflict prevention.

## Features

- **AWS Signature V4 Authentication**: Fully compliant with AWS S3 signature version 4
- **Filename Conflict Prevention**: Automatically generates unique filenames using GMT+8 timestamp and UUID
- **CORS Enabled**: Ready for cross-origin requests
- **5-Minute Expiration**: Time-limited upload URLs for security
- **Simple API**: Single endpoint with filename parameter

## Prerequisites

- Node.js and npm
- Cloudflare Workers account
- MinIO server (or any S3-compatible storage)

## Installation

1. Clone the repository:

```bash
git clone https://github.com/yyyxuu/minio-presign-worker.git
cd minio-presign-worker
```

2. Install dependencies:

```bash
npm install
```

## Configuration

Create a `.dev.vars` file for local development:

```bash
MINIO_ENDPOINT=your-minio-server.com
MINIO_PORT=9000
MINIO_BUCKET=your-bucket-name
MINIO_ACCESS_KEY=your-access-key
MINIO_SECRET_KEY=your-secret-key
MINIO_USE_SSL=false
MINIO_REGION=us-east-1
```

### Environment Variables

| Variable           | Required | Default   | Description                                      |
| ------------------ | -------- | --------- | ------------------------------------------------ |
| `MINIO_ENDPOINT`   | Yes      | -         | MinIO server address                             |
| `MINIO_BUCKET`     | Yes      | -         | Target bucket name                               |
| `MINIO_ACCESS_KEY` | Yes      | -         | MinIO access key                                 |
| `MINIO_SECRET_KEY` | Yes      | -         | MinIO secret key (should be encrypted as secret) |
| `MINIO_PORT`       | No       | 9000      | Server port (omitted from URL if 80 or 443)      |
| `MINIO_USE_SSL`    | No       | false     | Enable SSL (`true`/`false`)                      |
| `MINIO_REGION`     | No       | us-east-1 | AWS region for signing                           |

### Production Deployment Secrets

For production, sensitive values must be set as encrypted secrets:

```bash
wrangler secret put MINIO_ACCESS_KEY
wrangler secret put MINIO_SECRET_KEY
```

Other environment variables can be set in `wrangler.jsonc` or via the Cloudflare dashboard.

## Development

### Local Development

```bash
npm run dev
# or
npm start
```

The worker will run locally using configuration from `.dev.vars` merged with any encrypted secrets.

### Testing

```bash
npm test
```

Tests use Vitest with `@cloudflare/vitest-pool-workers` for Cloudflare Workers simulation. Test environment automatically reads from `.dev.vars`.

## Deployment

Deploy to Cloudflare Workers:

```bash
npm run deploy
```

## Usage

### API Endpoint

**POST** `/presignedUrl?filename=<filename>`

#### Query Parameters

- `filename` (required): The desired filename (will be modified to prevent conflicts)

#### Response

```json
{
	"upload_url": "https://minio-server.com/bucket/timestamp-uuid.ext?X-Amz-Algorithm=...",
	"public_url": "https://minio-server.com/bucket/timestamp-uuid.ext"
}
```

#### Example Usage

```bash
curl "https://your-worker.workers.dev/presignedUrl?filename=test.jpg"
```

Response:

```json
{
	"upload_url": "https://minio.example.com:9000/my-bucket/2025-01-05 12:34:56_a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=...&X-Amz-Date=20250105T043456Z&X-Amz-Expires=300&X-Amz-SignedHeaders=host&X-Amz-Signature=...",
	"public_url": "https://minio.example.com:9000/my-bucket/2025-01-05 12:34:56_a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg"
}
```

### Uploading Files

Use the returned `upload_url` to upload your file:

```bash
curl -X PUT -H "Content-Type: image/jpeg" \
  --data-binary @/path/to/your/file.jpg \
  "https://minio.example.com:9000/my-bucket/2025-01-05 12:34:56_a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg?X-Amz-Algorithm=..."
```

After successful upload, the file will be accessible at the `public_url` (if your MinIO bucket is publicly readable).

## How It Works

### Filename Transformation

The worker automatically prevents filename conflicts by:

1. Extracting the file extension from the original filename
2. Generating a unique identifier using:
   - Current timestamp in GMT+8 timezone (format: `YYYY-MM-DD HH:MM:SS`)
   - Random UUID
3. Combining them: `{timestamp}_{uuid}.{extension}`

Example:

- Input: `photo.jpg`
- Stored as: `2025-01-05 12:34:56_a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg`

### AWS Signature V4 Process

The worker implements AWS Signature Version 4 signing:

1. **Canonical Request**: HTTP method, URI, query parameters, headers, and payload hash
2. **String to Sign**: Algorithm, timestamp, credential scope, and hashed canonical request
3. **Signing Key Derivation**: HMAC chain (kDate → kRegion → kService → kSigning)
4. **Signature**: HMAC of string-to-sign with derived signing key
5. **Final URL**: Base URL with X-Amz-\* query parameters including signature

## Error Responses

All errors return JSON with an `error` field:

- **400 Bad Request**: Missing filename parameter

  ```json
  {
  	"error": "Missing filename parameter"
  }
  ```

- **404 Not Found**: Invalid path (only `/presignedUrl` is valid)

- **500 Internal Server Error**: Failed to generate presigned URL
  ```json
  {
  	"error": "Failed to generate presigned URL",
  	"details": "Error message"
  }
  ```

## Architecture

### Project Structure

```
minio-presign-worker/
├── src/
│   └── index.js          # Main worker entry point
├── public/
│   └── index.html        # Static demonstration page
├── test/
│   └── index.spec.js     # Test file
├── .dev.vars             # Local development environment (not in git)
├── wrangler.jsonc        # Cloudflare Workers configuration
├── package.json          # Dependencies and scripts
└── README.md             # This file
```

### Core Functions

- **`generatePresignedUrl(env, filename, expires)`**: Generates presigned upload URL with AWS SigV4
- **`sha256(message)`**: SHA-256 hash using Web Crypto API
- **`hmac(key, message, hexOutput)`**: HMAC-SHA256 signing
- **`getSignature(secretKey, dateStamp, stringToSign, region)`**: AWS SigV4 signing chain

## Browser Example

```javascript
async function uploadFile(file) {
	// 1. Get presigned URL
	const response = await fetch(`https://your-worker.workers.dev/presignedUrl?filename=${encodeURIComponent(file.name)}`);
	const { upload_url, public_url } = await response.json();

	// 2. Upload file directly to MinIO
	await fetch(upload_url, {
		method: 'PUT',
		body: file,
		headers: {
			'Content-Type': file.type,
		},
	});

	// 3. File is now accessible at public_url
	console.log('File uploaded:', public_url);
	return public_url;
}

// Usage
const fileInput = document.querySelector('#file-input');
fileInput.addEventListener('change', async (e) => {
	const file = e.target.files[0];
	const url = await uploadFile(file);
	console.log('Uploaded to:', url);
});
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
