import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

const ALLOWED_SIZES = new Set(["original", "thumbnail", "preview", "medium"]);
const VIDEO_KEY_PATTERN = /^users\/[^/]+\/photos\/[^/]+\/(video\.mp4|poster\.jpg|preview\.gif)$/;
const IMAGE_KEY_PATTERN = /^users\/[^/]+\/photos\/[^/]+\/original$/;

let ffmpegInstance = null;

async function getFFmpeg() {
  if (!ffmpegInstance) {
    ffmpegInstance = new FFmpeg();
    await ffmpegInstance.load({
      corePath: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/ffmpeg-core.js',
    });
  }
  return ffmpegInstance;
}

function fromBase64Url(value) {
  value = value.replace(/-/g, "+").replace(/_/g, "/");
  while (value.length % 4) value += "=";
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function verify(secret, message, signature) {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    return await crypto.subtle.verify("HMAC", key, fromBase64Url(signature), new TextEncoder().encode(message));
  } catch {
    return false;
  }
}

async function verifyRequest(request, env, allowedPatterns) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const size = url.searchParams.get("size") || "original";
  const expires = url.searchParams.get("exp");
  const signature = url.searchParams.get("sig");

  if (!key || !expires || !signature) {
    return { valid: false, response: new Response("Missing parameters", { status: 400 }) };
  }

  const expiry = Number(expires);
  if (!Number.isSafeInteger(expiry) || Math.floor(Date.now() / 1000) > expiry) {
    return { valid: false, response: new Response("URL expired", { status: 403 }) };
  }

  let patternMatch = false;
  for (const pattern of allowedPatterns) {
    if (pattern.test(key)) { patternMatch = true; break; }
  }
  if (!patternMatch) {
    return { valid: false, response: new Response("Invalid key format", { status: 400 }) };
  }

  const message = `${key}\n${size}\n${expires}`;
  const valid = await verify(env.IMAGE_SIGNING_SECRET, message, signature);
  if (!valid) {
    return { valid: false, response: new Response("Invalid signature", { status: 403 }) };
  }

  return { valid: true, key, size };
}

async function streamFromR2(env, key, request, contentType) {
  const object = await env.VIDEOS.get(key);
  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  const range = request.headers.get("Range");
  if (range) {
    const match = range.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : object.size - 1;
      const chunkSize = end - start + 1;

      const chunk = await env.VIDEOS.get(key, { range: [start, end] });
      if (!chunk) return new Response("Not found", { status: 404 });

      const headers = new Headers();
      headers.set("Content-Type", contentType);
      headers.set("Accept-Ranges", "bytes");
      headers.set("Content-Length", chunkSize.toString());
      headers.set("Content-Range", `bytes ${start}-${end}/${object.size}`);
      headers.set("Cache-Control", "private, max-age=300");
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "Content-Type, Range");

      return new Response(chunk.body, { status: 206, headers });
    }
  }

  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Length", object.size.toString());
  headers.set("Cache-Control", "private, max-age=300");
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Range");

  if (object.httpEtag) headers.set("ETag", object.httpEtag);

  return new Response(object.body, { status: 200, headers });
}

async function handleVideo(request, env) {
  const verification = await verifyRequest(request, env, [VIDEO_KEY_PATTERN]);
  if (!verification.valid) return verification.response;

  const baseKey = verification.key.replace(/\/(video\.mp4|poster\.jpg|preview\.gif)$/, '');
  const mp4Key = `${baseKey}/video.mp4`;
  return streamFromR2(env, mp4Key, request, "video/mp4");
}

async function handlePoster(request, env) {
  const verification = await verifyRequest(request, env, [VIDEO_KEY_PATTERN]);
  if (!verification.valid) return verification.response;

  const baseKey = verification.key.replace(/\/(video\.mp4|poster\.jpg|preview\.gif)$/, '');
  const posterKey = `${baseKey}/poster.jpg`;
  return streamFromR2(env, posterKey, request, "image/jpeg");
}

async function handlePreview(request, env) {
  const verification = await verifyRequest(request, env, [VIDEO_KEY_PATTERN]);
  if (!verification.valid) return verification.response;

  const baseKey = verification.key.replace(/\/(video\.mp4|poster\.jpg|preview\.gif)$/, '');
  const gifKey = `${baseKey}/preview.gif`;
  return streamFromR2(env, gifKey, request, "image/gif");
}

async function probeVideo(ffmpeg, inputBuffer) {
  ffmpeg.writeFile('input.mp4', await fetchFile(inputBuffer));
  await ffmpeg.exec(['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,duration', '-of', 'csv=p=0', 'input.mp4']);
  const output = ffmpeg.readFile('ffmpeg.log');
  ffmpeg.deleteFile('input.mp4');
  ffmpeg.deleteFile('ffmpeg.log');

  const lines = new TextDecoder().decode(output).trim().split('\n');
  const data = lines[lines.length - 1].split(',');
  return {
    codec: data[0]?.trim(),
    width: parseInt(data[1]?.trim(), 10),
    height: parseInt(data[2]?.trim(), 10),
    duration: parseFloat(data[3]?.trim()) || 0,
  };
}

async function processVideoSync(job, env) {
  const { originalKey, fileId, mimeType } = job;
  const ffmpeg = await getFFmpeg();

  const original = await env.VIDEOS.get(originalKey);
  if (!original) throw new Error("Original not found in R2");

  const inputBuffer = await original.arrayBuffer();
  const probe = await probeVideo(ffmpeg, inputBuffer);

  const baseKey = originalKey.replace('/original', '');
  const mp4Key = `${baseKey}/video.mp4`;
  const posterKey = `${baseKey}/poster.jpg`;
  const gifKey = `${baseKey}/preview.gif`;

  const isH264 = probe.codec === 'h264';
  const isMOV = mimeType === 'video/quicktime';

  ffmpeg.writeFile('input', await fetchFile(inputBuffer));

  if (isH264 && isMOV) {
    await ffmpeg.exec(['-i', 'input', '-c', 'copy', '-movflags', '+faststart', 'output.mp4']);
  } else {
    await ffmpeg.exec([
      '-i', 'input',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '22',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      'output.mp4'
    ]);
  }

  const mp4Data = ffmpeg.readFile('output.mp4');
  ffmpeg.deleteFile('output.mp4');

  await ffmpeg.exec(['-i', 'output.mp4', '-ss', '00:00:01', '-vframes', '1', '-f', 'image2', '-vcodec', 'mjpeg', 'poster.jpg']);
  const posterData = ffmpeg.readFile('poster.jpg');
  ffmpeg.deleteFile('poster.jpg');

  await ffmpeg.exec(['-i', 'output.mp4', '-t', '5', '-vf', 'fps=1,scale=320:-1', '-f', 'gif', 'preview.gif']);
  const gifData = ffmpeg.readFile('preview.gif');
  ffmpeg.deleteFile('preview.gif');

  await Promise.all([
    env.VIDEOS.put(mp4Key, mp4Data, { httpMetadata: { contentType: 'video/mp4' } }),
    env.VIDEOS.put(posterKey, posterData, { httpMetadata: { contentType: 'image/jpeg' } }),
    env.VIDEOS.put(gifKey, gifData, { httpMetadata: { contentType: 'image/gif' } }),
  ]);

  return {
    videoMp4Key: mp4Key,
    posterKey,
    previewGifKey: gifKey,
    duration: Math.round(probe.duration),
    width: probe.width,
    height: probe.height,
  };
}

async function notifyComplete(job, result, env) {
  const callbackUrl = `${env.NESTJS_INTERNAL_URL}/api/v1/uploads/internal/${job.fileId}/complete`;
  const response = await fetch(callbackUrl, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${env.INTERNAL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(result),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Complete callback failed: ${response.status} ${error}`);
  }

  return response;
}

async function handleProcess(request, env) {
  try {
    const job = await request.json();
    const result = await processVideoSync(job, env);

    await notifyComplete(job, result, env);

    return Response.json({ success: true, ...result });
  } catch (error) {
    console.error("Video processing failed:", error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}

async function handleQueue(batch, env) {
  for (const message of batch.messages) {
    try {
      const result = await processVideoSync(message.body, env);
      await notifyComplete(message.body, result, env);
      message.ack();
    } catch (error) {
      console.error("Queue processing failed:", error);
      message.retry();
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, POST, PATCH, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Range, Authorization",
        },
      });
    }

    if (url.pathname === "/health") {
      return new Response("OK", { status: 200, headers: { "Content-Type": "text/plain" } });
    }

    if (url.pathname === "/video") {
      return handleVideo(request, env);
    }

    if (url.pathname === "/video/poster") {
      return handlePoster(request, env);
    }

    if (url.pathname === "/video/preview") {
      return handlePreview(request, env);
    }

    if (url.pathname === "/internal/process" && request.method === "POST") {
      return handleProcess(request, env);
    }

    return new Response("Not found", { status: 404 });
  },

  async queue(batch, env) {
    return handleQueue(batch, env);
  },
};