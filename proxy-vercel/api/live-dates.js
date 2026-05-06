import { buildLiveDateManifest, DEFAULT_SNAPSHOT_BASE_URL } from "../shared/live-snapshot.mjs";

function applyCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  applyCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  try {
    const baseUrl = `https://${req.headers.host}`;
    const requestUrl = new URL(req.url || "/api/live-dates", baseUrl).toString();
    const data = await buildLiveDateManifest({
      requestUrl,
      snapshotBaseUrl: process.env.SNAPSHOT_BASE_URL || DEFAULT_SNAPSHOT_BASE_URL,
      fetchImpl: fetch
    });

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
