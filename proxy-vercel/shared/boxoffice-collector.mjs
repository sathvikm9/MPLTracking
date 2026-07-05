import { getIndiaTodayIso, isoToDateCode, MADANAPALLE_THEATRES } from "./theatre-discovery.mjs";
import { SAI_CHITRA_THEATRE } from "./ticketnew-live.mjs";
import { readBoxofficeSnapshot, writeBoxofficeSnapshot } from "./upstash-boxoffice.mjs";

const INDIA_TIMEZONE = "Asia/Kolkata";
const ACTIVE_THEATRES = new Set(["RTDM", "MSDR", "ASRM", "SKMD", "SAIC"]);
const CITY = {
  name: "Madanapalle",
  regionCode: "MDNP",
  timezone: INDIA_TIMEZONE,
  slug: "madanapalle",
  country: "India",
  state: "Andhra Pradesh"
};

const CAPTURE_POLICY = {
  RTDM: {
    fallbackCaptureAfterMinutes: 25,
    captureBeforeCutoffMinutes: 5,
    note: "Ravi captures about 5 minutes before the currently exposed cutoff."
  },
  MSDR: {
    fallbackCaptureAfterMinutes: 25,
    captureBeforeCutoffMinutes: 5,
    note: "Siddartha captures about 5 minutes before the currently exposed cutoff."
  },
  ASRM: {
    fallbackCaptureAfterMinutes: 12,
    captureBeforeCutoffMinutes: 3,
    note: "ASR captures about 3 minutes before the 15-minute cutoff."
  },
  SKMD: {
    fallbackCaptureAfterMinutes: 12,
    captureBeforeCutoffMinutes: 3,
    note: "Sri Krishna captures about 3 minutes before the 15-minute cutoff."
  },
  SAIC: {
    fallbackCaptureAfterMinutes: -3,
    captureBeforeCutoffMinutes: 0,
    includeBlockedSeatsInBoxoffice: true,
    note: "Sai Chitra TicketNew shows can disappear at showtime, so capture starts before showtime."
  }
};

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function showGross(show) {
  const categories = Array.isArray(show.categories) ? show.categories : [];
  if (!categories.length) return number(show.gross);

  return categories.reduce(
    (sum, category) => sum + number(category.soldSeats) * Math.max(number(category.price) - 5, 0),
    0
  );
}

function indiaWallClockIso(date = new Date()) {
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
  const map = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  );

  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}+05:30`;
}

function addMinutesToIso(iso, minutes) {
  const date = new Date(iso);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

function resolveCaptureAt(show, policy) {
  if (show.cutoffAt) {
    const cutoff = new Date(show.cutoffAt);
    if (Number.isFinite(cutoff.getTime())) {
      cutoff.setMinutes(cutoff.getMinutes() - number(policy.captureBeforeCutoffMinutes));
      return cutoff.toISOString();
    }
  }

  return addMinutesToIso(show.showDateTime, policy.fallbackCaptureAfterMinutes);
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

function isUntitledTicketNewDuplicate(show) {
  return (
    show?.venueCode === "SAIC" &&
    /^Untitled Movie$/i.test(String(show?.title || show?.releaseLabel || ""))
  );
}

function ticketNewSessionDedupeKey(show) {
  if (show?.venueCode !== "SAIC" || !show?.sessionId) return "";
  return [show.venueCode, show.sessionId, show.showDateTimeCode || show.showTimeLabel || ""].join("::");
}

function preferNamedTicketNewShow(existing, candidate) {
  if (!existing) return candidate;
  if (isUntitledTicketNewDuplicate(existing) && !isUntitledTicketNewDuplicate(candidate)) return candidate;
  return existing;
}

function dedupeTicketNewShows(shows) {
  const bySession = new Map();
  const passthrough = [];

  for (const show of shows || []) {
    const key = ticketNewSessionDedupeKey(show);
    if (!key) {
      passthrough.push(show);
      continue;
    }
    bySession.set(key, preferNamedTicketNewShow(bySession.get(key), show));
  }

  return [...passthrough, ...bySession.values()];
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

function normalizeShowForCapture(show, capturedAt, captureAt, policy) {
  const categories = Array.isArray(show.categories) ? show.categories : [];
  const includeBlockedSeats = Boolean(policy.includeBlockedSeatsInBoxoffice);
  const normalizedCategories = categories.map((category) => ({
    ...category,
    soldSeats: includeBlockedSeats ? number(category.rawSoldSeats ?? category.soldSeats) : number(category.soldSeats),
    actualSoldSeats: number(category.soldSeats),
    netPrice: Math.max(number(category.price) - 5, 0)
  }));
  const gross = includeBlockedSeats
    ? normalizedCategories.reduce(
        (sum, category) => sum + number(category.soldSeats) * Math.max(number(category.price) - 5, 0),
        0
      )
    : showGross(show);
  const totalSeats = number(show.totalSeats);
  const actualSoldSeats = number(show.soldSeats);
  const blockedSeats = number(show.blockedSeats);
  const soldSeats = includeBlockedSeats ? actualSoldSeats + blockedSeats : actualSoldSeats;

  return {
    ...show,
    key: captureKey(show),
    captureAt,
    capturedAt,
    capturePolicy: policy,
    categories: normalizedCategories,
    actualSoldSeats,
    soldSeats,
    gross,
    occupancyPercent: totalSeats ? Number(((soldSeats / totalSeats) * 100).toFixed(2)) : 0,
    boxofficeIncludesBlockedSeats: includeBlockedSeats,
    boxofficeSource: {
      method: "vercel-scheduled-cutoff-capture",
      capturedAt
    }
  };
}

async function fetchLiveTheatreSnapshot({ liveApiBase, date, venueCode, fetchImpl = fetch }) {
  const url = new URL(`${liveApiBase}/api/live`);
  url.searchParams.set("date", date);
  url.searchParams.set("venueCode", venueCode);
  url.searchParams.set("liveOnly", "1");
  url.searchParams.set("mirrorRetryRounds", "6");
  url.searchParams.set("ts", String(Date.now()));

  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json"
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 180)}`);
  }

  const data = JSON.parse(text);
  if (data.targetDate !== date) {
    throw new Error(`Wrong target date returned: ${data.targetDate || "unknown"}`);
  }

  return data;
}

function buildOutput({ date, existing, captures, plannedShows, errors, generatedAt }) {
  const sortedCaptures = dedupeTicketNewShows(captures).sort(compareShows);
  const sortedPlannedShows = dedupeTicketNewShows(plannedShows).sort(compareShows);

  return {
    version: 1,
    generatedAt,
    generatedAtIst: indiaWallClockIso(new Date(generatedAt)),
    targetDate: date,
    targetDateCode: isoToDateCode(date),
    timezone: INDIA_TIMEZONE,
    city: CITY,
    capturePolicy: CAPTURE_POLICY,
    summary: summarize(sortedCaptures),
    theatres: summarizeByTheatre(sortedCaptures),
    movies: summarizeByMovie(sortedCaptures),
    captures: sortedCaptures,
    plannedShows: sortedPlannedShows,
    meta: {
      status: errors.length ? "partial" : "ok",
      source: "vercel-scheduled-boxoffice",
      previousGeneratedAt: existing?.generatedAt || null,
      errors
    }
  };
}

export async function collectBoxofficeSnapshot({
  date = getIndiaTodayIso(),
  liveApiBase,
  fetchImpl = fetch,
  now = new Date()
}) {
  const generatedAt = now.toISOString();
  const existing = await readBoxofficeSnapshot(date);
  const capturesByKey = new Map((existing?.captures || []).map((show) => [show.key || captureKey(show), show]));
  const plannedByKey = new Map((existing?.plannedShows || []).map((show) => [show.key || captureKey(show), show]));
  const errors = [];
  const theatres = [...MADANAPALLE_THEATRES, SAI_CHITRA_THEATRE].filter((theatre) =>
    ACTIVE_THEATRES.has(theatre.venueCode)
  );

  await Promise.all(
    theatres.map(async (theatre) => {
      try {
        const snapshot = await fetchLiveTheatreSnapshot({
          liveApiBase,
          date,
          venueCode: theatre.venueCode,
          fetchImpl
        });
        const policy = CAPTURE_POLICY[theatre.venueCode] || {
          fallbackCaptureAfterMinutes: theatre.fallbackCutoffMinutes || 15,
          captureBeforeCutoffMinutes: 1,
          note: "Fallback theatre capture policy."
        };

        for (const show of snapshot.shows || []) {
          if (show.showDate !== date) continue;
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
    })
  );

  const data = buildOutput({
    date,
    existing,
    captures: Array.from(capturesByKey.values()),
    plannedShows: Array.from(plannedByKey.values()),
    errors,
    generatedAt
  });

  return writeBoxofficeSnapshot(data);
}
