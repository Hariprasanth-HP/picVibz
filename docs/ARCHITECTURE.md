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
| Message Broker    | RabbitMQ              |
| Cache             | Redis                 |
| Image Processing  | Sharp                 |
| Realtime          | WebSocket Gateway     |
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
 ┌──────┴───────────────┐
 │                      │
 ▼                      ▼
Supabase Auth      PostgreSQL
                      │
                  Prisma ORM
                      │
        ┌─────────────┴─────────────┐
        ▼                           ▼
 Cloudflare R2                  RabbitMQ
        │                           │
        │                    Image Processor
        │                    Notification Worker
        │                    Cleanup Worker
        │                    Analytics Worker
        │
        ▼
      Redis
        │
        ▼
   WebSocket Gateway
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

```
User Selects Photos

↓

Frontend Upload

↓

Upload Progress

0% → 100%

↓

Cloudflare R2

↓

Save Metadata

↓

Publish RabbitMQ Message

↓

Return Success
```

The upload is complete before RabbitMQ begins processing.

---

# Image Processing Flow

RabbitMQ processes uploaded images asynchronously.

```
RabbitMQ

↓

Image Processor

↓

Download Original

↓

Generate Thumbnail

↓

Generate Medium Image

↓

Compress Image

↓

Extract EXIF Metadata

↓

Generate Blur Placeholder

↓

Upload Processed Images

↓

Update Database

↓

Notify Frontend
```

---

# Image Versions

Every uploaded image generates three versions.

```
Original
IMG_001.jpg

↓

Medium
IMG_001_medium.webp

↓

Thumbnail
IMG_001_thumb.webp
```

---

# Image Usage

| Image     | Used For                        |
| --------- | ------------------------------- |
| Thumbnail | Gallery, Albums, Search Results |
| Medium    | Photo Viewer                    |
| Original  | Download, Zoom, Share           |

---

# Gallery Flow

Gallery loads thumbnails only.

```
Gallery

↓

Thumbnail

↓

Click Photo

↓

Medium Image

↓

Zoom

↓

Original Image
```

This minimizes bandwidth and improves scrolling performance.

---

# RabbitMQ Workers

## Image Processor

Responsibilities

* Generate Thumbnail
* Compress Images
* Convert to WebP
* Generate Blur Placeholder
* Extract EXIF
* Update Database

---

## Notification Worker

Responsibilities

* Album Shared
* Upload Completed
* Storage Warning
* New Shared Photo

---

## Cleanup Worker

Responsibilities

* Delete Temporary Files
* Remove Expired Shares
* Cleanup Failed Uploads

---

## Analytics Worker

Responsibilities

* Storage Statistics
* User Analytics
* Daily Reports

---

# Bulk Upload

```
User Selects 500 Photos

↓

Upload Progress

↓

Cloudflare R2

↓

Save Metadata

↓

RabbitMQ

↓

Parallel Image Processing

↓

Notify UI

↓

Ready
```

---

# Bulk Download

```
User Selects Photos

↓

Download Request

↓

RabbitMQ

↓

Create ZIP

↓

Upload ZIP to Cloudflare R2

↓

Notify User

↓

Download ZIP
```

---

# Database Status

Photo Status

```
UPLOADING

↓

UPLOADED

↓

PROCESSING

↓

READY

↓

FAILED
```

---

# Redis

Redis is used for

* API Caching
* Rate Limiting
* Session Cache
* Frequently Accessed Metadata
* WebSocket Presence
* Temporary Upload Cache

Redis is **not** used as a message queue.

RabbitMQ handles all asynchronous messaging.

---

# Cloudflare R2 Structure

```
users/

    user-id/

        originals/

        medium/

        thumbnails/

        downloads/

        avatars/
```

---

# Security

* JWT Authentication
* Role Based Access Control
* Permission Based Authorization
* HTTPS Only
* Secure Object Storage
* Signed Download URLs
* DTO Validation
* Global Exception Filters
* Request Rate Limiting
* Audit Logging

---

# Folder Structure

```
src/

├── auth/
├── users/
├── photos/
├── albums/
├── uploads/
├── storage/
├── rabbitmq/
├── workers/
│
├── websocket/
├── notifications/
├── analytics/
├── prisma/
├── redis/
├── common/
│
├── config/
└── main.ts
```

---

# Future Features

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

---

# Architecture Principles

* Authentication handled by Supabase.
* Authorization handled by NestJS.
* Metadata stored in PostgreSQL using Prisma.
* Original and processed images stored in Cloudflare R2.
* RabbitMQ manages all asynchronous background processing.
* Redis provides caching and high-performance data access.
* WebSockets deliver real-time upload and processing updates.
* Image processing is fully decoupled from the upload API to ensure fast responses and horizontal scalability.

---

# Project Goal

**PicVibz** is designed as an enterprise-grade, cloud-native photo management platform capable of handling millions of photos through a scalable microservice-inspired architecture. The system emphasizes performance, security, extensibility, and a seamless user experience while remaining modular enough to support future AI-powered capabilities.
