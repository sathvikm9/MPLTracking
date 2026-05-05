import {
  buildHealthPayload,
  buildLiveSnapshot,
  DEFAULT_SNAPSHOT_BASE_URL
} from "../../shared/live-snapshot.mjs";

function withCors(headers = {}) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    ...headers
  };
}

function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: withCors({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {})
    })
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: withCors()
      });
    }

    if (url.pathname === "/health") {
      return jsonResponse(buildHealthPayload());
    }

    if (url.pathname === "/api/live") {
      try {
        const refreshed = await buildLiveSnapshot({
          requestUrl: request.url,
          snapshotBaseUrl: env.SNAPSHOT_BASE_URL || DEFAULT_SNAPSHOT_BASE_URL,
          fetchImpl: fetch
        });
        return jsonResponse(refreshed);
      } catch (error) {
        return jsonResponse(
          {
            ok: false,
            error: error.message
          },
          {
            status: 500
          }
        );
      }
    }

    return jsonResponse(
      {
        ok: false,
        error: "Not found"
      },
      {
        status: 404
      }
    );
  }
};
