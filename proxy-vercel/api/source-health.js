import { checkMadanapalleShowtimesSources, normalizeDateCode } from "../shared/madanapalle-showtimes.mjs";
import { getIndiaTodayIso } from "../shared/theatre-discovery.mjs";

const BFILMY_DAILY_DATA_BASE_URL = "https://bfilmyapi.pages.dev/daily/data";

function applyCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Cache-Control", "no-store");
}

async function checkBfilmyCityFeed({ date, fetchImpl = fetch }) {
  const dateCode = normalizeDateCode(date);
  const url = `${BFILMY_DAILY_DATA_BASE_URL}/${dateCode}/finalsummary.json?ts=${Date.now()}`;
  const startedAt = Date.now();

  try {
    const response = await fetchImpl(url, {
      cache: "no-store",
      headers: {
        accept: "application/json, text/plain, */*",
        referer: "https://bfilmy.pages.dev/Live%20Boxoffice/",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
      }
    });
    const payload = await response.json();
    const madanapalleMovies = Object.entries(payload?.movies || {}).filter(([, movie]) =>
      (movie?.details || []).some((entry) => String(entry?.city || "").toLowerCase() === "madanapalle")
    );

    return {
      ok: response.ok && madanapalleMovies.length > 0,
      status: response.status,
      durationMs: Date.now() - startedAt,
      lastUpdated: payload?.last_updated || "",
      madanapalleMovies: madanapalleMovies.length
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      durationMs: Date.now() - startedAt,
      error: error.message
    };
  }
}

export default async function handler(req, res) {
  applyCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const baseUrl = `https://${req.headers.host}`;
    const requestUrl = new URL(req.url || "/api/source-health", baseUrl);
    const date = requestUrl.searchParams.get("date") || getIndiaTodayIso();
    const eventCode = requestUrl.searchParams.get("eventCode") || "ET00455003";
    const venueCode = requestUrl.searchParams.get("venueCode") || "RTDM";

    const [bmsShowtimes, bfilmyCityFeed] = await Promise.all([
      checkMadanapalleShowtimesSources({
        eventCode,
        date,
        venueCode,
        fetchImpl: fetch
      }),
      checkBfilmyCityFeed({
        date,
        fetchImpl: fetch
      })
    ]);

    res.status(200).json({
      ok: Boolean(bmsShowtimes.ok || bfilmyCityFeed.ok),
      generatedAt: new Date().toISOString(),
      targetDate: date,
      checks: {
        bmsShowtimes,
        bfilmyCityFeed
      }
    });
  } catch (error) {
    res.status(error.status || 500).json({
      ok: false,
      error: error.message
    });
  }
}
