const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function getRedisConfig() {
  return {
    url: String(process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, ""),
    token: String(process.env.UPSTASH_REDIS_REST_TOKEN || "")
  };
}

function assertValidDate(date) {
  if (!DATE_PATTERN.test(String(date || ""))) {
    throw new Error("Invalid date. Use YYYY-MM-DD.");
  }
}

function keyForDate(date) {
  assertValidDate(date);
  return `mpltracking:boxoffice:${date}`;
}

async function runRedisCommand(command) {
  const config = getRedisConfig();
  if (!config.url || !config.token) {
    const error = new Error("Upstash Redis is not configured.");
    error.statusCode = 503;
    throw error;
  }

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(command)
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { error: text };
  }

  if (!response.ok || payload?.error) {
    const error = new Error(payload?.error || `${response.status} ${response.statusText}`);
    error.statusCode = response.status || 500;
    throw error;
  }

  return payload?.result;
}

export async function readBoxofficeSnapshot(date) {
  const raw = await runRedisCommand(["GET", keyForDate(date)]);
  if (!raw) return null;

  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

export async function writeBoxofficeSnapshot(snapshot) {
  const date = snapshot?.targetDate;
  assertValidDate(date);

  const value = JSON.stringify({
    ...snapshot,
    meta: {
      ...(snapshot.meta || {}),
      storage: {
        provider: "upstash-redis",
        writtenAt: new Date().toISOString()
      }
    }
  });

  await runRedisCommand(["SET", keyForDate(date), value]);
  await runRedisCommand(["SET", "mpltracking:boxoffice:latest", value]);

  return JSON.parse(value);
}
