import { readBoxofficeSnapshot } from "../shared/upstash-boxoffice.mjs";

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

  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const baseUrl = `https://${req.headers.host}`;
    const requestUrl = new URL(req.url || "/api/boxoffice", baseUrl);
    const date = requestUrl.searchParams.get("date");
    const data = await readBoxofficeSnapshot(date);

    if (!data) {
      res.status(404).json({ ok: false, error: "No boxoffice data for selected date." });
      return;
    }

    res.status(200).json({
      ...data,
      meta: {
        ...(data.meta || {}),
        clientSource: "upstash-redis"
      }
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message
    });
  }
}
