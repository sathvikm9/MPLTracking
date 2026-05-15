import { collectBoxofficeSnapshot } from "../shared/boxoffice-collector.mjs";
import { getIndiaTodayIso } from "../shared/theatre-discovery.mjs";

function applyCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-boxoffice-collect-token");
  res.setHeader("Cache-Control", "no-store");
}

function requestOrigin(req) {
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${protocol}://${host}`;
}

function assertAuthorized(req, url) {
  const expectedToken = String(process.env.BOXOFFICE_COLLECT_TOKEN || process.env.CRON_SECRET || "");
  if (!expectedToken) return;

  const headerToken = String(req.headers["x-boxoffice-collect-token"] || "");
  const queryToken = String(url.searchParams.get("token") || "");

  if (headerToken === expectedToken || queryToken === expectedToken) return;

  const error = new Error("Unauthorized collector request.");
  error.statusCode = 401;
  throw error;
}

export default async function handler(req, res) {
  applyCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (!["GET", "POST"].includes(req.method)) {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const url = new URL(req.url || "/api/boxoffice-collect", requestOrigin(req));
    assertAuthorized(req, url);

    const date = url.searchParams.get("date") || getIndiaTodayIso();
    const liveApiBase = process.env.LIVE_API_BASE || requestOrigin(req);
    const data = await collectBoxofficeSnapshot({
      date,
      liveApiBase: liveApiBase.replace(/\/$/, ""),
      fetchImpl: fetch
    });

    res.status(200).json({
      ok: true,
      targetDate: data.targetDate,
      generatedAt: data.generatedAt,
      generatedAtIst: data.generatedAtIst,
      captures: data.captures?.length || 0,
      plannedShows: data.plannedShows?.length || 0,
      totalSold: data.summary?.totalSold || 0,
      totalGross: data.summary?.totalGross || 0,
      errors: data.meta?.errors || []
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message
    });
  }
}
