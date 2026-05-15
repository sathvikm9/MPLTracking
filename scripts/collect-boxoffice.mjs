import fs from "node:fs/promises";
import path from "node:path";

import { parseArgs } from "./lib/cli.mjs";
import { getIndiaDateParts, resolveTargetDate } from "./lib/date.mjs";

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, "config", "city.json");
const RUNTIME_CONFIG_PATH = path.join(ROOT, "public", "runtime-config.json");
const BOXOFFICE_DIR = path.join(ROOT, "public", "data", "boxoffice");
const PUBLISHED_BOXOFFICE_BASE =
  process.env.BOXOFFICE_EXISTING_BASE ||
  "https://sathvikm9.github.io/MPLTracking/data/boxoffice";
const INDIA_TIMEZONE = "Asia/Kolkata";
const ACTIVE_THEATRES = new Set(["RTDM", "MSDR", "ASRM", "SKMD"]);
const CAPTURE_POLICY = {
  RTDM: {
    fallbackCaptureAfterMinutes: 28,
    captureBeforeCutoffMinutes: 2,
    note: "Ravi BMS payload currently exposes a 30-minute cutoff, so capture 2 minutes before cutoff."
  },
  MSDR: {
    fallbackCaptureAfterMinutes: 28,
    captureBeforeCutoffMinutes: 2,
    note: "Siddartha BMS payload currently exposes a 30-minute cutoff, so capture 2 minutes before cutoff."
  },
  ASRM: {
    fallbackCaptureAfterMinutes: 14,
    captureBeforeCutoffMinutes: 1,
    note: "ASR cutoff is 15 minutes after showtime, so capture about 1 minute before cutoff."
  },
  SKMD: {
    fallbackCaptureAfterMinutes: 14,
    captureBeforeCutoffMinutes: 1,
    note: "Sri Krishna cutoff is 15 minutes after showtime, so capture about 1 minute before cutoff."
  }
};

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function showGross(show) {
  const categories = Array.isArray(show.categories) ? show.categories : [];
  if (!categories.length) return number(show.gross);

  return categories.reduce((sum, category) => {
    const soldSeats = number(category.soldSeats);
    const netPrice = number(category.netPrice) || Math.max(number(category.price) - 5, 0);
    return sum + soldSeats * netPrice;
  }, 0);
}

function indiaNowParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: INDIA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);

  return Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  );
}

function indiaWallClockIso(date = new Date()) {
  const parts = indiaNowParts(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+05:30`;
}

function addMinutesToShowIso(showIso, minutes) {
  const date = new Date(showIso);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

function resolveCaptureAt(show, policy) {
  if (show.cutoffAt) {
    const cutoffDate = new Date(show.cutoffAt);
    if (Number.isFinite(cutoffDate.getTime())) {
      cutoffDate.setMinutes(cutoffDate.getMinutes() - number(policy.captureBeforeCutoffMinutes));
      return cutoffDate.toISOString();
    }
  }

  return addMinutesToShowIso(show.showDateTime, policy.fallbackCaptureAfterMinutes);
}

function captureKey(show) {
  return [
    show.venueCode || "",
    show.showDateTimeCode || show.showTimeLabel || "",
    show.eventCode || "",
    show.sessionId || ""
  ].join("::");
}

function compareShows(left, right) {
  const timeCompare = String(left.showDateTime || "").localeCompare(String(right.showDateTime || ""));
  if (timeCompare) return timeCompare;
  return String(left.theatreShortName || "").localeCompare(String(right.theatreShortName || ""));
}

function summarize(shows) {
  const totalShows = shows.length;
  const totalCapacity = shows.reduce((sum, show) => sum + number(show.totalSeats), 0);
  const totalAvailable = shows.reduce((sum, show) => sum + number(show.availableSeats), 0);
  const totalSold = shows.reduce((sum, show) => sum + number(show.soldSeats), 0);
  const totalGross = shows.reduce((sum, show) => sum + showGross(show), 0);

  return {
    totalShows,
    totalCapacity,
    totalAvailable,
    totalSold,
    totalGross,
    occupancyPercent: totalCapacity ? Number(((totalSold / totalCapacity) * 100).toFixed(2)) : 0,
    ff: 0,
    hf: 0
  };
}

function summarizeByTheatre(shows) {
  const map = new Map();

  for (const show of shows) {
    const venueCode = show.venueCode || "UNKNOWN";
    if (!map.has(venueCode)) {
      map.set(venueCode, {
        venueCode,
        name: show.venueName || venueCode,
        shortName: show.theatreShortName || venueCode,
        shows: []
      });
    }

    map.get(venueCode).shows.push(show);
  }

  return Array.from(map.values())
    .map((entry) => ({
      ...entry,
      ...summarize(entry.shows),
      shows: undefined
    }))
    .sort((left, right) => right.totalGross - left.totalGross || left.shortName.localeCompare(right.shortName));
}

function summarizeByMovie(shows) {
  const map = new Map();

  for (const show of shows) {
    const key = [show.releaseLabel || show.title || "Unknown Movie", show.language || "", show.format || ""].join("::");
    if (!map.has(key)) {
      map.set(key, {
        key,
        eventCode: show.eventCode,
        title: show.releaseLabel || show.title || "Unknown Movie",
        language: show.language || "",
        format: show.format || "",
        shows: []
      });
    }

    map.get(key).shows.push(show);
  }

  return Array.from(map.values())
    .map((entry) => ({
      ...entry,
      ...summarize(entry.shows),
      shows: undefined
    }))
    .sort((left, right) => right.totalGross - left.totalGross || left.title.localeCompare(right.title));
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function loadLiveApiBase() {
  if (process.env.LIVE_API_BASE) {
    return process.env.LIVE_API_BASE.replace(/\/$/, "");
  }

  const runtimeConfig = await readJson(RUNTIME_CONFIG_PATH, {});
  const liveApiBase = String(runtimeConfig.liveApiBase || "").trim();
  if (!liveApiBase) {
    throw new Error("Missing liveApiBase in public/runtime-config.json");
  }

  return liveApiBase.replace(/\/$/, "");
}

async function fetchPublishedBoxoffice(isoDate) {
  const url = `${PUBLISHED_BOXOFFICE_BASE.replace(/\/$/, "")}/${isoDate}.json?ts=${Date.now()}`;

  try {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.warn(`Unable to reuse published boxoffice file: ${error.message}`);
    return null;
  }
}

async function fetchLiveTheatreSnapshot(liveApiBase, targetDate, venueCode) {
  const url = new URL(`${liveApiBase}/api/live`);
  url.searchParams.set("date", targetDate.isoDate);
  url.searchParams.set("venueCode", venueCode);
  url.searchParams.set("strict", "1");
  url.searchParams.set("ts", String(Date.now()));

  const response = await fetch(url, { headers: { accept: "application/json" } });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 180)}`);
  }

  const data = JSON.parse(text);
  if (data.targetDate !== targetDate.isoDate) {
    throw new Error(`Wrong target date returned: ${data.targetDate || "unknown"}`);
  }

  return data;
}

function normalizeShowForCapture(show, capturedAt, captureAt, policy) {
  const categories = Array.isArray(show.categories) ? show.categories : [];
  const gross = showGross(show);
  const totalSeats = number(show.totalSeats);
  const soldSeats = number(show.soldSeats);

  return {
    ...show,
    key: captureKey(show),
    captureAt,
    capturedAt,
    capturePolicy: policy,
    categories: categories.map((category) => ({
      ...category,
      netPrice: number(category.netPrice) || Math.max(number(category.price) - 5, 0)
    })),
    gross,
    occupancyPercent: totalSeats ? Number(((soldSeats / totalSeats) * 100).toFixed(2)) : 0,
    boxofficeSource: {
      method: "scheduled-live-cutoff-capture",
      capturedAt
    }
  };
}

function buildOutput({ config, targetDate, existing, captures, plannedShows, errors, generatedAt }) {
  const sortedCaptures = [...captures].sort(compareShows);

  return {
    version: 1,
    generatedAt,
    generatedAtIst: indiaWallClockIso(new Date(generatedAt)),
    targetDate: targetDate.isoDate,
    targetDateCode: targetDate.dateCode,
    timezone: config.city.timezone,
    city: config.city,
    capturePolicy: CAPTURE_POLICY,
    summary: summarize(sortedCaptures),
    theatres: summarizeByTheatre(sortedCaptures),
    movies: summarizeByMovie(sortedCaptures),
    captures: sortedCaptures,
    plannedShows: [...plannedShows].sort(compareShows),
    meta: {
      status: errors.length ? "partial" : "ok",
      source: "github-actions-scheduled-boxoffice",
      previousGeneratedAt: existing?.generatedAt || null,
      errors
    }
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetDate = args.date ? resolveTargetDate(args) : getIndiaDateParts();
  const config = await readJson(CONFIG_PATH, null);
  const liveApiBase = await loadLiveApiBase();
  const outputPath = path.join(BOXOFFICE_DIR, `${targetDate.isoDate}.json`);
  const existing = (await readJson(outputPath, null)) || (await fetchPublishedBoxoffice(targetDate.isoDate));
  const capturesByKey = new Map((existing?.captures || []).map((show) => [show.key || captureKey(show), show]));
  const plannedByKey = new Map();
  const errors = [];
  const now = new Date();
  const generatedAt = now.toISOString();
  const theatres = config.theatres.filter(
    (theatre) => theatre.active !== false && ACTIVE_THEATRES.has(theatre.venueCode)
  );

  for (const theatre of theatres) {
    try {
      const snapshot = await fetchLiveTheatreSnapshot(liveApiBase, targetDate, theatre.venueCode);
      const policy = CAPTURE_POLICY[theatre.venueCode] || {
        fallbackCaptureAfterMinutes: theatre.fallbackCutoffMinutes || 15,
        captureBeforeCutoffMinutes: 1,
        note: "Fallback theatre capture policy."
      };

      for (const show of snapshot.shows || []) {
        if (show.showDate !== targetDate.isoDate) continue;
        if (show.venueCode !== theatre.venueCode) continue;
        if (!show.showDateTime) continue;

        const captureAt = resolveCaptureAt(show, policy);
        const key = captureKey(show);
        plannedByKey.set(key, {
          ...show,
          key,
          captureAt,
          capturePolicy: policy
        });

        if (now >= new Date(captureAt) && number(show.totalSeats) > 0) {
          capturesByKey.set(key, normalizeShowForCapture(show, generatedAt, captureAt, policy));
        }
      }
    } catch (error) {
      errors.push(`${theatre.shortName}: ${error.message}`);
    }
  }

  await fs.mkdir(BOXOFFICE_DIR, { recursive: true });
  const data = buildOutput({
    config,
    targetDate,
    existing,
    captures: Array.from(capturesByKey.values()),
    plannedShows: Array.from(plannedByKey.values()),
    errors,
    generatedAt
  });

  await fs.writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(BOXOFFICE_DIR, "latest.json"), `${JSON.stringify(data, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        generatedAt: data.generatedAt,
        targetDate: data.targetDate,
        captures: data.captures.length,
        plannedShows: data.plannedShows.length,
        totalSold: data.summary.totalSold,
        totalGross: data.summary.totalGross,
        errors
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
