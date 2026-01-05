# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Cloudflare Worker that generates presigned URLs for MinIO object storage using AWS Signature Version 4 authentication. The worker creates time-limited (5-minute) upload URLs that grant temporary access to specific files in a MinIO bucket.

## Development Commands

```bash
# Local development (reads from .dev.vars and merges with secrets)
npm run dev
# or
npm start

# Deploy to Cloudflare Workers
npm run deploy

# Run tests
npm test
```

## Environment Configuration

All MinIO configuration is done through environment variables:

### Required Variables
- `MINIO_ENDPOINT`: MinIO server address
- `MINIO_BUCKET`: Target bucket name
- `MINIO_ACCESS_KEY`: MinIO access key (set as secret)
- `MINIO_SECRET_KEY`: MinIO secret key (set as secret)

### Optional Variables
- `MINIO_PORT`: Server port (default: 9000)
- `MINIO_USE_SSL`: Enable SSL (`true`/`false`, default: false)
- `MINIO_REGION`: AWS region (default: us-east-1)

### Secret Management
Development variables are stored in `.dev.vars` (not in git). For production, sensitive values must be set as secrets:
```bash
wrangler secret put MINIO_ACCESS_KEY
wrangler secret put MINIO_SECRET_KEY
```

Use `wrangler dev --local` to test locally with merged dev vars and secrets.

## Architecture

### Main Endpoint: `/presignedUrl`

**Method:** POST
**Query Parameter:** `filename` (required)
**Response:** JSON with `upload_url` and `public_url`

The worker only responds to `/presignedUrl` - all other paths return 404.

### Core Functions

#### `generatePresignedUrl(env, filename, expires)`
Implements AWS Signature V4 signing to create authenticated MinIO upload URLs.

**Key steps:**
1. Normalizes filename encoding (handles path separators and spaces)
2. Generates ISO8601 timestamp for AWS signing
3. Builds canonical request with PUT method, headers, and UNSIGNED-PAYLOAD
4. Creates signature using HMAC-SHA256 chain: date → region → service → signing
5. Constructs final URL with X-Amz-* query parameters

**URL encoding behavior:**
- Filenames are URL-encoded using `encodeURIComponent()`
- `%2F` is converted back to `/` to preserve paths
- `+` is converted to `%20` for proper space encoding

#### Crypto Utilities
- `sha256(message)`: SHA-256 hash using Web Crypto API
- `hmac(key, message, hexOutput)`: HMAC-SHA256 signing
- `getSignature(secretKey, dateStamp, stringToSign, region)`: AWS SigV4 signing chain

### AWS Signature Version 4 Implementation

The signing process follows AWS S3 signature v4:
1. Create canonical request (method + URI + query + headers + payload hash)
2. Hash canonical request with SHA-256
3. Create string to sign with timestamp, credential scope, and hash
4. Derive signing key: HMAC chain of kDate → kRegion → kService → kSigning
5. Sign string to sign with derived key
6. Add signature to URL as `X-Amz-Signature`

### Static Assets

Files in `./public/` directory are served at root path. Currently contains `index.html` for demonstration.

## Testing

Tests use Vitest with `@cloudflare/vitest-pool-workers` for Cloudflare Workers simulation. Note that `test/index.spec.js` currently contains placeholder test code that doesn't match the actual worker functionality (`/message` and `/random` endpoints don't exist in the current implementation).

When running tests with `npm test`, Wrangler automatically reads `.dev.vars` for environment configuration.

## Code Conventions

- ES6 module syntax with async/await
- Chinese comments for business logic explanations
- Error responses return JSON with `error` and optional `details` fields
- All API responses include CORS header: `Access-Control-Allow-Origin: *`
- Port is only included in URLs if not 80/443
- Expiration hardcoded to 5 minutes (300 seconds)

## Compatibility Flags

- `nodejs_compat`: Enables Node.js compatibility layer
- `global_fetch_strictly_public`: Ensures fetch API is publicly accessible
