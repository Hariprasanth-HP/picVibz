# PicVibz Backend Architecture

> **PicVibz** is a modern cloud-based photo management platform inspired by Google Photos. It provides secure photo backup, album management, intelligent image processing, sharing, and scalable cloud storage.

---

# Technology Stack

| Layer             | Technology            |
| ----------------- | --------------------- |
| Backend Framework | NestJS                |
| Language          | TypeScript            |
| Database          | PostgreSQL (Supabase) |
| ORM               | Prisma                |
| Authentication    | Supabase Auth         |
| Authorization     | NestJS Guards + RBAC  |
| Object Storage    | Cloudflare R2         |
| Image Processing  | Sharp (server) / Cloudflare Images (edge) |
| Edge Delivery     | Cloudflare Workers    |
| API Documentation | Swagger               |
| Validation        | class-validator       |
| Logging           | Pino                  |
| Containerization  | Docker                |
| Reverse Proxy     | Nginx                 |

---

# System Architecture

```
React / React Native
        │
        ▼
    NestJS API
        │
  ┌─────┴───────────────┐
  │                     │
  ▼                     ▼
Supabase Auth      PostgreSQL
                       │
                   Prisma ORM
                       │
         ┌─────────────┴─────────────┐
         ▼                           ▼
  Cloudflare R2              Cloudflare Worker
         │                           │
         │                    Image Transform
         │                    (Cloudflare Images)
         │                           │
         ▼                           ▼
      Signed URLs               CDN Delivery
         │
         ▼
    Frontend
```

---

# Authentication

Authentication is completely handled by **Supabase Auth**.

Supported providers

* Email & Password
* Google Sign In
* Email Verification
* Password Reset
* JWT Access Tokens
* Refresh Tokens

The backend never stores passwords.

---

# Authorization

Authorization is handled by NestJS.

### JWT Verification

Every request

```
Client

↓

Supabase JWT

↓

NestJS Auth Guard

↓

Current User

↓

Roles Guard

↓

Permissions Guard

↓

Controller
```

---

# User Flow

## Signup

```
User

↓

Supabase Signup

↓

Verify Email

↓

NestJS

↓

Create User Profile

↓

Default Album

↓

Return Profile
```

---

## Google Login

```
Google OAuth

↓

Supabase

↓

JWT

↓

NestJS

↓

Create Profile (First Login)

↓

Return User
```

---

# Upload Flow

Two upload paths are supported:

## Path A: Direct-to-R2 (Presigned URLs) — Primary for Large Files

```
Client
  │
  ├─► POST /uploads/init {fileName, mimeType, size, eventId?}
  │       │
  │       └─► Returns {uploadId, uploadUrl, storageKey}
  │
  ├─► PUT {file} → uploadUrl (direct to Cloudflare R2)
  │
  └─► POST /uploads/:id/complete
          │
          └─► Verifies object in R2
              │
              └─► Updates status to READY
                  │
                  └─► Creates Photo record (if eventId)
                      │
                      └─► Returns signed URLs for all variants
```

## Path B: Server-Side Multipart — Simple/Small Files

```
Client
  │
  ├─► POST /files (multipart/form-data)
  │       │
  │       └─► Sharp processes image
  │           ├─► Thumbnail (200px)
  │           ├─► Preview (800px)
  │           └─► Original
  │
  ├─► Uploads all 3 variants to R2
  │
  └─► Creates File record with status READY
```

---

# Image Processing Flow

**On-demand transformation via Cloudflare Worker + Cloudflare Images** (no background queue):

```
Client Request
  │
  ├─► GET /image?key=...&size=thumbnail|preview|medium|original&exp=...&sig=...
  │       │
  │       └─► Cloudflare Worker validates signature & expiry
  │           │
  │           ├─► size=original → Stream directly from private R2
  │           │
  │           └─► size=thumbnail|preview|medium
  │               │
  │               └─► Cloudflare Images transform
  │                   ├─► Resize (scale-down)
  │                   ├─► Convert to WebP
  │                   └─► Quality per variant
  │
  └─► Returns transformed image with caching headers
```

**Variant Dimensions:**
- **Thumbnail**: 300px width, WebP, quality 75
- **Preview**: 1600px width, WebP, quality 80
- **Medium**: 1600px width, WebP, quality 80
- **Original**: Served as-is from R2

---

# Image Versions

Every uploaded image has **four accessible variants** (generated on-demand):

```
Original (R2)
  │
  ├─► Thumbnail  ──► 300px WebP (quality 75)
  ├─► Preview    ──► 1600px WebP (quality 80)
  ├─► Medium     ──► 1600px WebP (quality 80)
  └─► Original   ──► As uploaded
```

Server-side upload (Path B) also pre-generates at upload time:
- Thumbnail: 200px JPEG (quality 80)
- Preview: 800px JPEG (quality 85)
- Original: As uploaded

---

# Image Usage

| Image     | Used For                        |
| --------- | ------------------------------- |
| Thumbnail | Gallery, Albums, Search Results |
| Preview   | Photo Viewer (initial load)     |
| Medium    | Photo Viewer (full screen)      |
| Original  | Download, Zoom, Share           |

---

# Database Status

`File.status` (MediaStatus enum):

```
UPLOADING   →  Initial record created, awaiting client upload
READY       →  Upload verified, accessible via signed URLs
FAILED      →  Error during upload/processing (optional)
```

> Note: `UPLOADED` and `PROCESSING` states exist in enum but are not used in current flows. Processing is on-demand at delivery time.

---

# Cloudflare R2 Structure

```
users/
    {userId}/
        photos/
            {fileId}/
                original      (original upload)
```

> Processed variants are **not stored** in R2. They are generated on-demand by Cloudflare Images and cached at the edge.

---

# Image Delivery (Cloudflare Worker)

Deployed at `worker.js` — serves signed, expiring URLs:

**Security:**
- HMAC-SHA256 signed URLs (`key`, `size`, `exp` covered)
- Short TTL (default 300s / 5 min)
- Key pattern restricted: `^users\/[^/]+\/photos\/[^/]+\/original$`
- Private R2 bucket — no public access

**Response Headers:**
- `Cache-Control: private, max-age=300`
- `Access-Control-Allow-Origin: *`
- `Content-Type: image/webp` (transformed) or original mime type

---

# Security

* JWT Authentication (Supabase)
* Role Based Access Control
* Permission Based Authorization
* HTTPS Only
* Private Object Storage (R2)
* Signed Download URLs with HMAC + Expiry
* DTO Validation (class-validator)
* Global Exception Filters
* Request Rate Limiting

---

# Folder Structure

```
src/
├── auth/
├── uploads/          # Direct-to-R2 presigned upload flow
├── files/            # Server-side multipart upload + Sharp processing
├── storage/          # R2 client + presigned URL generation
├── photos/           # Photo queries (with signed URLs)
├── events/           # Event/album management
├── prisma/
├── common/
│   ├── guards/
│   ├── pipes/
│   ├── utils/        # image-url-signer.ts (HMAC signing)
│   ├── interceptors/
│   └── filters/
├── supabase/         # Supabase client wrapper
├── config/
└── main.ts
```

---

# Architecture Principles

* Authentication handled by Supabase.
* Authorization handled by NestJS.
* Metadata stored in PostgreSQL using Prisma.
* Original images stored in **private** Cloudflare R2.
* **No background queue** — image transformations happen on-demand at the edge via Cloudflare Worker + Cloudflare Images.
* Processed variants are **not persisted** — generated and cached by Cloudflare CDN.
* Signed URLs with short TTL enforce access control.
* Two upload paths: direct-to-R2 (scalable) and server-side (simple).

---

# Future / Planned Features

* AI Search
* Face Recognition
* OCR
* Similar Image Detection
* Duplicate Detection
* Smart Albums
* Shared Libraries
* Live Photos
* Video Compression
* Timeline View
* Map View
* Offline Sync
* Device Backup
* End-to-End Encryption
* Storage Saver Mode
* **Background Workers (RabbitMQ)** — for async tasks like bulk operations, notifications, analytics
* **Redis Caching** — for metadata, sessions, rate limiting
* **WebSocket Gateway** — for real-time upload/processing progress

---

# Project Goal

**PicVibz** is designed as a cloud-native photo management platform capable of handling millions of photos through a scalable architecture. The system emphasizes performance, security, extensibility, and a seamless user experience while remaining modular enough to support future AI-powered capabilities. Current implementation leverages Cloudflare's edge network for zero-ops image processing and global delivery.