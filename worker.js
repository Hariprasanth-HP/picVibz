const ALLOWED_SIZES = new Set([
  "original",
  "thumbnail",
  "preview",
  "medium",
]);

const KEY_PATTERN =
  /^users\/[^/]+\/photos\/[^/]+\/original$/;

function fromBase64Url(value) {
  value = value.replace(/-/g, "+").replace(/_/g, "/");

  while (value.length % 4) {
    value += "=";
  }

  const binary = atob(value);

  return Uint8Array.from(binary, (char) =>
    char.charCodeAt(0)
  );
}

async function verify(secret, message, signature) {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      {
        name: "HMAC",
        hash: "SHA-256",
      },
      false,
      ["verify"]
    );

    return await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(signature),
      new TextEncoder().encode(message)
    );
  } catch {
    return false;
  }
}

function getTransform(size) {
  switch (size) {
    case "thumbnail":
      return {
        width: 300,
        quality: 75,
      };

    case "preview":
      return {
        width: 1600,
        quality: 80,
      };

    case "medium":
      return {
        width: 1600,
        quality: 80,
      };

    default:
      return null;
  }
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET") {
      return new Response("Method not allowed", {
        status: 405,
        headers: {
          Allow: "GET",
        },
      });
    }

    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/health") {
      return new Response("OK", {
        status: 200,
        headers: {
          "Content-Type": "text/plain",
        },
      });
    }

    // Image endpoint only
    if (url.pathname !== "/image") {
      return new Response("Not found", {
        status: 404,
      });
    }

    const key = url.searchParams.get("key");
    const size =
      url.searchParams.get("size") || "original";
    const expires = url.searchParams.get("exp");
    const signature = url.searchParams.get("sig");

    // Validate parameters
    if (!key || !expires || !signature) {
      return new Response("Missing parameters", {
        status: 400,
      });
    }

    // Validate image size
    if (!ALLOWED_SIZES.has(size)) {
      return new Response("Invalid size", {
        status: 400,
      });
    }

    // Validate expiration
    const expiry = Number(expires);

    if (!Number.isSafeInteger(expiry)) {
      return new Response("Invalid expiry", {
        status: 400,
      });
    }

    const now = Math.floor(Date.now() / 1000);

    if (now > expiry) {
      return new Response("URL expired", {
        status: 403,
      });
    }

    // Prevent arbitrary R2 object access
    if (!KEY_PATTERN.test(key)) {
      return new Response("Invalid key format", {
        status: 400,
      });
    }

    // Signature must cover exactly these values
    const message =
      `${key}\n${size}\n${expires}`;

    const valid = await verify(
      env.IMAGE_SIGNING_SECRET,
      message,
      signature
    );

    if (!valid) {
      return new Response("Invalid signature", {
        status: 403,
      });
    }

    // Read the original from PRIVATE R2
    const object = await env.IMAGES.get(key);

    if (!object) {
      return new Response("Image not found", {
        status: 404,
      });
    }

    /*
     * ORIGINAL
     *
     * Return original R2 object directly.
     */
    if (size === "original") {
      const headers = new Headers();

      headers.set(
        "Content-Type",
        object.httpMetadata?.contentType ||
          "application/octet-stream"
      );

      headers.set(
        "Cache-Control",
        "private, max-age=300"
      );

      headers.set(
        "Access-Control-Allow-Origin",
        "*"
      );

      headers.set(
        "Access-Control-Allow-Methods",
        "GET, HEAD"
      );

      headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type"
      );

      if (object.httpEtag) {
        headers.set(
          "ETag",
          object.httpEtag
        );
      }

      return new Response(object.body, {
        status: 200,
        headers,
      });
    }

    /*
     * THUMBNAIL / PREVIEW / MEDIUM
     *
     * Transform the private R2 object using
     * the Cloudflare Images binding.
     */
    const transform = getTransform(size);

    if (!transform) {
      return new Response("Invalid image size", {
        status: 400,
      });
    }

    try {
      const transformed =
        await env.IMAGE_TRANSFORM
          .input(object.body)
          .transform({
            width: transform.width,
            fit: "scale-down",
          })
          .output({
            format: "webp",
            quality: transform.quality,
          });

      const response =
        transformed.response();

      const headers = new Headers(
        response.headers
      );

      headers.set(
        "Content-Type",
        "image/webp"
      );

      headers.set(
        "Cache-Control",
        "private, max-age=300"
      );

      headers.set(
        "Access-Control-Allow-Origin",
        "*"
      );

      headers.set(
        "Access-Control-Allow-Methods",
        "GET, HEAD"
      );

      headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type"
      );

      return new Response(
        response.body,
        {
          status: response.status,
          headers,
        }
      );
    } catch (error) {
      console.error(
        "Image transformation failed:",
        error
      );

      return new Response(
        "Failed to transform image",
        {
          status: 502,
        }
      );
    }
  },
};