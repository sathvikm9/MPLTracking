import { verifyGithubActionsToken } from "../shared/github-oidc.mjs";
import { writeBoxofficeSnapshot } from "../shared/upstash-boxoffice.mjs";

function applyCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-boxoffice-ingest-token");
  res.setHeader("Cache-Control", "no-store");
}

async function readBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function assertAuthorized(req) {
  const expectedToken = String(process.env.BOXOFFICE_INGEST_TOKEN || "");
  const actualToken = String(req.headers["x-boxoffice-ingest-token"] || "");

  if (expectedToken && actualToken === expectedToken) {
    return;
  }

  const authorization = String(req.headers.authorization || "");
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  await verifyGithubActionsToken(token);
}

export default async function handler(req, res) {
  applyCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    await assertAuthorized(req);
    const body = await readBody(req);
    const data = await writeBoxofficeSnapshot(body);

    res.status(200).json({
      ok: true,
      targetDate: data.targetDate,
      generatedAt: data.generatedAt,
      captures: data.captures?.length || 0,
      plannedShows: data.plannedShows?.length || 0,
      totalSold: data.summary?.totalSold || 0,
      totalGross: data.summary?.totalGross || 0
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message
    });
  }
}
