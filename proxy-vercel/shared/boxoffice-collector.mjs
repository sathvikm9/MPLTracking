import { getIndiaTodayIso, isoToDateCode, MADANAPALLE_THEATRES } from "./theatre-discovery.mjs";
import { SAI_CHITRA_THEATRE } from "./ticketnew-live.mjs";
import { readBoxofficeSnapshot, writeBoxofficeSnapshot } from "./upstash-boxoffice.mjs";

const INDIA_TIMEZONE = "Asia/Kolkata";
const ACTIVE_THEATRES = new Set(["RTDM", "MSDR", "ASRM", "SKMD", "SAIC"]);
const TICKETNEW_THEATRES = new Set(["SAIC"]);
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
    captureBeforeCutoffMinutes: 5,
    note: "ASR starts capture about 5 minutes before the 15-minute cutoff, then keeps the latest successful run."
  },
  SKMD: {
    fallbackCaptureAfterMinutes: 12,
    captureBeforeCutoffMinutes: 5,
    note: "Sri Krishna starts capture about 5 minutes before the 15-minute cutoff, then keeps the latest successful run."
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

function validDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function captureKey(show) {
  return [
    show.venueCode || "",
    show.showDateTimeCode || show.showTimeLabel || "",
    show.eventCode || "",
    show.sessionId || ""
  ].join("::");
}

function removePlannedShowsForTheatreDate(plannedByKey, venueCode, date) {
  for (const [key, show] of plannedByKey.entries()) {
    if (show?.venueCode === venueCode && show?.showDate === date) {
      plannedByKey.delete(key);
    }
  }
}

function plannedShowsForTheatreDate(plannedByKey, venueCode, date) {
  return Array.from(plannedByKey.values()).filter(
    (show) => show?.venueCode === venueCode && show?.showDate === date
  );
}

function compareShows(left, right) {
  const timeCompare = String(left.showDateTime || "").localeCompare(String(right.showDateTime || ""));
  if (timeCompare) return timeCompare;
  return String(left.theatreShortName || "").localeCompare(String(right.theatreShortName || ""));
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.min(Math.max(Number(limit) || 1, 1), items.length || 1);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(items[index], index);
      }
    })
  );

  return results;
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

function buildLiveSnapshotUrl({ liveApiBase, date, venueCode, isTicketNew }) {
  const url = new URL(`${liveApiBase}/api/live`);
  url.searchParams.set("date", date);
  url.searchParams.set("liveOnly", "1");
  url.searchParams.set("allowCache", "0");
  url.searchParams.set("venueCode", venueCode);
  url.searchParams.set("mirrorRetryRounds", isTicketNew ? "1" : "6");
  if (!isTicketNew) {
    url.searchParams.set("allowPartialEvents", "1");
    url.searchParams.set("mirrorOnly", "1");
  }
  url.searchParams.set("ts", String(Date.now()));
  return url;
}

async function fetchLiveSnapshotUrl({ url, expectedDate, isTicketNew, fetchImpl }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), isTicketNew ? 15000 : 18000);

  const response = await fetchImpl(url, {
    signal: controller.signal,
    headers: {
      accept: "application/json"
    }
  }).finally(() => clearTimeout(timeout));
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 180)}`);
  }

  const data = JSON.parse(text);
  if (data.targetDate !== expectedDate) {
    throw new Error(`Wrong target date returned: ${data.targetDate || "unknown"}`);
  }

  return data;
}

async function fetchLiveTheatreSnapshot({ liveApiBase, date, venueCode, fetchImpl = fetch }) {
  const normalizedVenueCode = String(venueCode || "").toUpperCase();
  const isTicketNew = TICKETNEW_THEATRES.has(normalizedVenueCode);
  const url = buildLiveSnapshotUrl({
    liveApiBase,
    date,
    venueCode: normalizedVenueCode,
    isTicketNew
  });

  return fetchLiveSnapshotUrl({
    url,
    expectedDate: date,
    isTicketNew,
    fetchImpl
  });
}

function buildOutput({ date, existing, captures, plannedShows, errors, generatedAt }) {
  const sortedCaptures = [...captures].sort(compareShows);

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
    plannedShows: [...plannedShows].sort(compareShows),
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

  await mapWithConcurrency(
    theatres,
    2,
    async (theatre) => {
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

        const incomingShows = (snapshot.shows || []).filter(
          (show) => show.showDate === date && show.venueCode === theatre.venueCode && show.showDateTime
        );
        const existingPlannedShows = plannedShowsForTheatreDate(plannedByKey, theatre.venueCode, date);
        const shouldReplacePlan =
          !existingPlannedShows.length || incomingShows.length >= existingPlannedShows.length;

        if (shouldReplacePlan) {
          removePlannedShowsForTheatreDate(plannedByKey, theatre.venueCode, date);
        }

        for (const show of incomingShows) {
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
