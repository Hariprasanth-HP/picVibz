const ALLOWED_SIZES = new Set([
  "original",
  "thumbnail",
  "preview",
  "medium",
]);

const KEY_PATTERN =
  /^users\/[^/]+\/photos\/[^/]+\/(original|thumbnail|preview|medium)$/;

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

    // The key must end with the requested variant
    if (!key.endsWith(`/${size}`)) {
      return new Response("Key/size mismatch", {
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

    // Serve the pre-generated variant directly from PRIVATE R2
    const object = await env.IMAGES.get(key);

    if (!object) {
      return new Response("Image not found", {
        status: 404,
      });
    }

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
  },
};
