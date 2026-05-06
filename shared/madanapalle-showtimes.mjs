const MADANAPALLE_REGION_CODE = "MDNP";
const SHOWTIME_API_BASE_URLS = [
  "https://bms-india2.vercel.app/api/showtimes",
  "https://bms-india3.vercel.app/api/showtimes",
  "https://bms-india.vercel.app/api/showtimes"
];
const SHOWTIME_API_RETRY_ROUNDS = 3;
const SHOWTIME_API_RETRY_DELAY_MS = 700;
const LAST_GOOD_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 6;

const SHOWTIME_API_HEADERS = {
  accept: "application/json, text/plain, */*",
  "cache-control": "no-cache",
  origin: "https://boxoffice24.pages.dev",
  pragma: "no-cache",
  referer: "https://boxoffice24.pages.dev/",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
};

const lastGoodPayloadCache =
  globalThis.__MADANAPALLE_LAST_GOOD_SHOWTIME_PAYLOADS__ || new Map();
globalThis.__MADANAPALLE_LAST_GOOD_SHOWTIME_PAYLOADS__ = lastGoodPayloadCache;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeDateCode(date) {
  const value = String(date || "").trim();
  if (/^\d{8}$/.test(value)) return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.replaceAll("-", "");
  return "";
}

function assertValidMirrorParams({ eventCode, dateCode }) {
  if (!/^ET\d+$/i.test(eventCode || "")) {
    const error = new Error("A valid BookMyShow eventCode is required.");
    error.status = 400;
    throw error;
  }

  if (!/^\d{8}$/.test(dateCode || "")) {
    const error = new Error("A valid date or dateCode is required.");
    error.status = 400;
    throw error;
  }
}

function filterPayloadByVenueCode(payload, venueCode) {
  if (!venueCode) return payload;

  return {
    ...payload,
    ShowDetails: (payload.ShowDetails || []).map((showDetail) => ({
      ...showDetail,
      Venues: (showDetail.Venues || []).filter((venue) => venue.VenueCode === venueCode)
    }))
  };
}

function summarizePayload(payload) {
  const venues = [];
  let showCount = 0;

  for (const showDetail of payload.ShowDetails || []) {
    for (const venue of showDetail.Venues || []) {
      const showTimes = Array.isArray(venue.ShowTimes) ? venue.ShowTimes : [];
      showCount += showTimes.length;
      venues.push({
        venueCode: venue.VenueCode,
        venueName: venue.VenueName,
        showCount: showTimes.length
      });
    }
  }

  return {
    showDetails: Array.isArray(payload.ShowDetails) ? payload.ShowDetails.length : 0,
    venues,
    showCount
  };
}

function buildCacheKey({ eventCode, dateCode }) {
  return `${eventCode}:${dateCode}`;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function readLastGoodPayload({ eventCode, dateCode, venueCode, attempts }) {
  const cacheKey = buildCacheKey({ eventCode, dateCode });
  const cached = lastGoodPayloadCache.get(cacheKey);
  if (!cached) return null;

  const ageMs = Date.now() - cached.cachedAtMs;
  if (ageMs > LAST_GOOD_CACHE_MAX_AGE_MS) {
    lastGoodPayloadCache.delete(cacheKey);
    return null;
  }

  const payload = filterPayloadByVenueCode(cloneJson(cached.payload), venueCode);
  return {
    payload,
    meta: {
      ...cached.meta,
      venueCode: venueCode || "",
      upstream: `${cached.meta.upstream} (last-good-cache)`,
      attempts,
      summary: summarizePayload(payload),
      generatedAt: new Date().toISOString(),
      cache: {
        hit: true,
        cachedAt: cached.cachedAt,
        ageMs
      }
    }
  };
}

function writeLastGoodPayload({ eventCode, dateCode, payload, meta }) {
  lastGoodPayloadCache.set(buildCacheKey({ eventCode, dateCode }), {
    payload: cloneJson(payload),
    meta: {
      ...meta,
      venueCode: "",
      summary: summarizePayload(payload),
      cache: {
        hit: false
      }
    },
    cachedAt: new Date().toISOString(),
    cachedAtMs: Date.now()
  });
}

export async function fetchMadanapalleShowtimesPayload({
  eventCode,
  date,
  dateCode,
  venueCode = "",
  fetchImpl = fetch
}) {
  const normalizedEventCode = String(eventCode || "").trim().toUpperCase();
  const normalizedDateCode = normalizeDateCode(dateCode || date);
  let lastError = null;
  const attempts = [];

  assertValidMirrorParams({
    eventCode: normalizedEventCode,
    dateCode: normalizedDateCode
  });

  for (let round = 0; round < SHOWTIME_API_RETRY_ROUNDS; round += 1) {
    for (const baseUrl of SHOWTIME_API_BASE_URLS) {
      const startedAt = Date.now();

      try {
        const url = new URL(baseUrl);
        url.searchParams.set("eventCode", normalizedEventCode);
        url.searchParams.set("regionCode", MADANAPALLE_REGION_CODE);
        url.searchParams.set("dateCode", normalizedDateCode);
        url.searchParams.set("_", `${Date.now()}-${round}`);

        const response = await fetchImpl(url, {
          cache: "no-store",
          headers: SHOWTIME_API_HEADERS
        });
        const text = await response.text();

        attempts.push({
          upstream: baseUrl,
          round: round + 1,
          status: response.status,
          durationMs: Date.now() - startedAt
        });

        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 200)}`);
        }

        const payload = JSON.parse(text);
        if (!Array.isArray(payload?.ShowDetails)) {
          throw new Error("Missing ShowDetails in showtime payload");
        }

        const fullPayload = cloneJson(payload);
        const filteredPayload = filterPayloadByVenueCode(payload, venueCode);
        const meta = {
          regionCode: MADANAPALLE_REGION_CODE,
          eventCode: normalizedEventCode,
          dateCode: normalizedDateCode,
          venueCode: venueCode || "",
          upstream: baseUrl,
          attempts,
          summary: summarizePayload(filteredPayload),
          generatedAt: new Date().toISOString(),
          cache: {
            hit: false
          }
        };

        writeLastGoodPayload({
          eventCode: normalizedEventCode,
          dateCode: normalizedDateCode,
          payload: fullPayload,
          meta
        });

        return {
          payload: filteredPayload,
          meta
        };
      } catch (error) {
        lastError = error;
        if (!attempts.length || attempts[attempts.length - 1].upstream !== baseUrl) {
          attempts.push({
            upstream: baseUrl,
            round: round + 1,
            status: 0,
            durationMs: Date.now() - startedAt,
            error: error.message
          });
        } else {
          attempts[attempts.length - 1].error = error.message;
        }
      }
    }

    if (round < SHOWTIME_API_RETRY_ROUNDS - 1) {
      await sleep(SHOWTIME_API_RETRY_DELAY_MS * (round + 1));
    }
  }

  const cached = readLastGoodPayload({
    eventCode: normalizedEventCode,
    dateCode: normalizedDateCode,
    venueCode,
    attempts
  });
  if (cached) {
    return cached;
  }

  const error = lastError || new Error(`Unable to fetch showtime payload for ${normalizedEventCode}`);
  error.status = error.status || 502;
  error.attempts = attempts;
  throw error;
}

export async function buildMadanapalleShowtimesMirror({ requestUrl, fetchImpl = fetch }) {
  const url = new URL(requestUrl);
  const eventCode = url.searchParams.get("eventCode");
  const date = url.searchParams.get("date");
  const dateCode = url.searchParams.get("dateCode");
  const venueCode = url.searchParams.get("venueCode") || "";
  const { payload, meta } = await fetchMadanapalleShowtimesPayload({
    eventCode,
    date,
    dateCode,
    venueCode,
    fetchImpl
  });

  return {
    ok: true,
    ...meta,
    payload
  };
}
