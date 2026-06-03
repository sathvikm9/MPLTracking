import { getIndiaTodayIso, isoToDateCode, MADANAPALLE_THEATRES } from "./theatre-discovery.mjs";
import { SAI_CHITRA_THEATRE } from "./ticketnew-live.mjs";
import { readBoxofficeSnapshot, writeBoxofficeSnapshot } from "./upstash-boxoffice.mjs";

const INDIA_TIMEZONE = "Asia/Kolkata";
const BFILMY_DAILY_DATA_BASE_URL = "https://bfilmyapi.pages.dev/daily/data";
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
    captureAfterShowMinutes: 28,
    fallbackCaptureAfterMinutes: 28,
    captureBeforeCutoffMinutes: 0,
    note: "Ravi captures 28 minutes after showtime; BMS cutoff time is ignored."
  },
  MSDR: {
    captureAfterShowMinutes: 28,
    fallbackCaptureAfterMinutes: 28,
    captureBeforeCutoffMinutes: 0,
    note: "Siddartha captures 28 minutes after showtime; BMS cutoff time is ignored."
  },
  ASRM: {
    captureAfterShowMinutes: 14,
    fallbackCaptureAfterMinutes: 14,
    captureBeforeCutoffMinutes: 0,
    note: "ASR captures 14 minutes after showtime; BMS cutoff time is ignored."
  },
  SKMD: {
    captureAfterShowMinutes: 14,
    fallbackCaptureAfterMinutes: 14,
    captureBeforeCutoffMinutes: 0,
    note: "Sri Krishna captures 14 minutes after showtime; BMS cutoff time is ignored."
  },
  SAIC: {
    fallbackCaptureAfterMinutes: -3,
    captureBeforeCutoffMinutes: 0,
    includeBlockedSeatsInBoxoffice: true,
    note: "Sai Chitra TicketNew shows can disappear at showtime, so capture starts before showtime."
  }
};

const MANUAL_PLAN_OVERRIDES = {
  "2026-05-28": {
    note: "Manual plan override added because BMS discovery is blocked and the known May 28 plan is 5 theatres with 4 shows each.",
    theatres: {
      RTDM: ["11:00 AM", "02:15 PM", "06:00 PM", "09:15 PM"],
      MSDR: ["11:00 AM", "02:15 PM", "06:15 PM", "09:15 PM"],
      ASRM: ["11:00 AM", "02:15 PM", "06:00 PM", "09:15 PM"],
      SKMD: ["11:00 AM", "02:00 PM", "06:00 PM", "09:00 PM"],
      SAIC: ["11:00 AM", "02:15 PM", "06:00 PM", "09:15 PM"]
    }
  },
  "2026-06-04": {
    note: "Manual plan override added because Vercel BMS discovery is blocked and June 4 was verified locally as 5 theatres with 6 Peddi shows each.",
    theatres: {
      RTDM: ["12:30 AM", "05:00 AM", "09:00 AM", "01:30 PM", "05:30 PM", "09:30 PM"],
      MSDR: ["12:30 AM", "05:00 AM", "09:00 AM", "01:30 PM", "05:30 PM", "09:30 PM"],
      ASRM: ["12:30 AM", "05:00 AM", "09:00 AM", "01:30 PM", "05:30 PM", "09:30 PM"],
      SKMD: ["12:30 AM", "05:00 AM", "09:00 AM", "01:30 PM", "05:30 PM", "09:30 PM"],
      SAIC: ["12:30 AM", "05:00 AM", "09:00 AM", "01:30 PM", "05:30 PM", "09:30 PM"]
    }
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

function timeLabelToParts(label) {
  const match = String(label || "").trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3].toUpperCase();
  if (meridiem === "PM" && hour !== 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;

  return {
    hour: String(hour).padStart(2, "0"),
    minute: String(minute).padStart(2, "0")
  };
}

function manualPlanKey(venueCode, showDateTimeCode) {
  return [venueCode || "", showDateTimeCode || "", "MANUAL-PLAN", ""].join("::");
}

function buildManualPlannedShow({ date, theatre, showTimeLabel, policy, note }) {
  const parts = timeLabelToParts(showTimeLabel);
  if (!parts) return null;

  const showDateCode = isoToDateCode(date);
  const showDateTimeCode = `${showDateCode}${parts.hour}${parts.minute}`;
  const showDateTime = `${date}T${parts.hour}:${parts.minute}:00+05:30`;
  const show = {
    id: `MANUAL-PLAN-${theatre.venueCode}-${showDateTimeCode}`,
    key: manualPlanKey(theatre.venueCode, showDateTimeCode),
    eventCode: "",
    sessionId: "",
    platform: theatre.platform || "bookmyshow",
    venueCode: theatre.venueCode,
    venueName: theatre.name,
    theatreShortName: theatre.shortName,
    citySlug: CITY.slug,
    showDate: date,
    showDateCode,
    showDateTime,
    showDateTimeCode,
    showTimeLabel,
    cutoffAt: "",
    cutoffCode: "",
    format: "",
    language: "",
    title: "Manual planned show",
    releaseLabel: "Manual planned show",
    screenName: theatre.shortName,
    totalSeats: 0,
    availableSeats: 0,
    soldSeats: 0,
    gross: 0,
    occupancyPercent: 0,
    plannedOnly: true,
    manualPlan: true,
    source: {
      method: "manual-plan-override",
      note
    },
    capturePolicy: policy
  };

  return {
    ...show,
    captureAt: resolveCaptureAt(show, policy)
  };
}

function applyManualPlanOverride({ plannedByKey, date, theatres, notes }) {
  const override = MANUAL_PLAN_OVERRIDES[date];
  if (!override) return;

  const theatreByCode = new Map(theatres.map((theatre) => [theatre.venueCode, theatre]));
  const existingSlots = new Map();
  for (const [key, show] of plannedByKey.entries()) {
    existingSlots.set(`${show.venueCode || ""}::${show.showDateTimeCode || ""}`, { key, show });
  }

  for (const [venueCode, slots] of Object.entries(override.theatres || {})) {
    const theatre = theatreByCode.get(venueCode);
    if (!theatre) continue;
    const policy = CAPTURE_POLICY[theatre.venueCode] || {
      fallbackCaptureAfterMinutes: theatre.fallbackCutoffMinutes || 15,
      captureBeforeCutoffMinutes: 1,
      note: "Fallback theatre capture policy."
    };

    for (const showTimeLabel of slots) {
      const plannedShow = buildManualPlannedShow({
        date,
        theatre,
        showTimeLabel,
        policy,
        note: override.note
      });
      if (!plannedShow) continue;
      const slotKey = `${plannedShow.venueCode}::${plannedShow.showDateTimeCode}`;
      const existing = existingSlots.get(slotKey);
      if (existing && !existing.show.plannedOnly) continue;
      if (existing) plannedByKey.delete(existing.key);
      plannedByKey.set(plannedShow.key, plannedShow);
      existingSlots.set(slotKey, { key: plannedShow.key, show: plannedShow });
    }
  }

  if (override.note) notes.push(override.note);
}

function refreshPlannedCapturePolicies({ plannedByKey, theatres }) {
  const theatreByCode = new Map(theatres.map((theatre) => [theatre.venueCode, theatre]));

  for (const [key, show] of plannedByKey.entries()) {
    if (!show.showDateTime) continue;
    const theatre = theatreByCode.get(show.venueCode);
    const policy = CAPTURE_POLICY[show.venueCode] || {
      fallbackCaptureAfterMinutes: theatre?.fallbackCutoffMinutes || 15,
      captureBeforeCutoffMinutes: 1,
      note: "Fallback theatre capture policy."
    };

    plannedByKey.set(key, {
      ...show,
      captureAt: resolveCaptureAt(show, policy),
      capturePolicy: policy
    });
  }
}

function resolveCaptureAt(show, policy) {
  if (Number.isFinite(Number(policy.captureAfterShowMinutes))) {
    return addMinutesToIso(show.showDateTime, number(policy.captureAfterShowMinutes));
  }

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

function summarize(shows) {
  const totalShows = shows.reduce((sum, show) => sum + number(show.boxofficeShowCount || 1), 0);
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

function parseBfilmyMovieKey(movieKey) {
  const value = String(movieKey || "").trim();
  const match = value.match(/^(.*?)\s*\[([^|\]]+)\|\s*([^\]]+)\]\s*$/);
  if (!match) {
    return {
      title: value || "Unknown Movie",
      format: "",
      language: ""
    };
  }

  return {
    title: match[1].trim() || "Unknown Movie",
    format: match[2].trim(),
    language: match[3].trim()
  };
}

function normalizeBfilmyChainVenue(chainName) {
  const value = String(chainName || "").trim();
  const normalized = value.toLowerCase();

  if (!normalized.includes("madanapalle")) return null;
  if (normalized.includes("siddartha")) {
    return {
      venueCode: "MSDR",
      venueName: "Siddartha Cinemas:Screen 2 Dolby Laser,Madanapalle",
      theatreShortName: "Siddartha"
    };
  }
  if (normalized.includes("sri krishna")) {
    return {
      venueCode: "SKMD",
      venueName: "Sri Krishna A/C 4K Dolby Atmos: Madanapalle",
      theatreShortName: "Sri Krishna"
    };
  }
  if (normalized.includes("ravi")) {
    return {
      venueCode: "RTDM",
      venueName: "Ravi A/C 4K Laser Dolby Surround 7.1: Madanapalle",
      theatreShortName: "Ravi"
    };
  }
  if (normalized.includes("asr")) {
    return {
      venueCode: "ASRM",
      venueName: "ASR A/C 4K Laser Dolby Surround 7.1: Madanapalle",
      theatreShortName: "ASR"
    };
  }

  return {
    venueCode: `BFILMY-${value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toUpperCase()}`,
    venueName: value,
    theatreShortName: value.replace(/:.*$/, "").trim() || "BFilmy venue"
  };
}

function buildBfilmyCityFallback({ date, payload, generatedAt }) {
  const captures = [];
  const venueCaptures = [];
  const moviesPayload = payload?.movies && typeof payload.movies === "object" ? payload.movies : {};

  for (const [movieKey, movie] of Object.entries(moviesPayload)) {
    const cityRow = (movie?.details || []).find(
      (entry) => String(entry?.city || "").toLowerCase() === "madanapalle"
    );
    if (!cityRow) continue;

    const parsedMovie = parseBfilmyMovieKey(movieKey);
    const totalSeats = number(cityRow.totalSeats);
    const soldSeats = number(cityRow.sold);
    const gross = number(cityRow.gross);
    const showCount = number(cityRow.shows);
    const venueCount = number(cityRow.venues);

    captures.push({
      id: `BFILMY-${date}-${movieKey}`,
      key: `BFILMY::${date}::${movieKey}`,
      eventCode: "",
      sessionId: "",
      platform: "bfilmy",
      venueCode: "BFILMY",
      venueName: "BFilmy Madanapalle City Feed",
      theatreShortName: "City Feed",
      citySlug: CITY.slug,
      showDate: date,
      showDateCode: isoToDateCode(date),
      showDateTime: `${date}T00:00:00+05:30`,
      showDateTimeCode: `${isoToDateCode(date)}0000`,
      showTimeLabel: "City",
      cutoffAt: "",
      cutoffCode: "",
      format: parsedMovie.format,
      language: parsedMovie.language,
      title: parsedMovie.title,
      releaseLabel: parsedMovie.title,
      screenName: "Madanapalle",
      totalSeats,
      availableSeats: Math.max(totalSeats - soldSeats, 0),
      soldSeats,
      gross,
      occupancyPercent: totalSeats ? Number(((soldSeats / totalSeats) * 100).toFixed(2)) : number(cityRow.occupancy),
      ff: number(cityRow.fastfilling),
      hf: number(cityRow.housefull),
      boxofficeShowCount: showCount,
      boxofficeVenueCount: venueCount,
      boxofficeSource: {
        method: "bfilmy-city-summary",
        capturedAt: generatedAt,
        lastUpdated: payload.last_updated || ""
      }
    });

    for (const chainRow of movie?.Chain_details || []) {
      const venue = normalizeBfilmyChainVenue(chainRow.chain);
      if (!venue) continue;

      const chainTotalSeats = number(chainRow.totalSeats);
      const chainSoldSeats = number(chainRow.sold);
      venueCaptures.push({
        id: `BFILMY-VENUE-${date}-${movieKey}-${chainRow.chain}`,
        key: `BFILMY-VENUE::${date}::${movieKey}::${chainRow.chain}`,
        eventCode: "",
        sessionId: "",
        platform: "bfilmy",
        ...venue,
        citySlug: CITY.slug,
        showDate: date,
        showDateCode: isoToDateCode(date),
        showDateTime: `${date}T00:00:00+05:30`,
        showDateTimeCode: `${isoToDateCode(date)}0000`,
        showTimeLabel: "Venue",
        cutoffAt: "",
        cutoffCode: "",
        format: parsedMovie.format,
        language: parsedMovie.language,
        title: parsedMovie.title,
        releaseLabel: parsedMovie.title,
        screenName: venue.theatreShortName,
        totalSeats: chainTotalSeats,
        availableSeats: Math.max(chainTotalSeats - chainSoldSeats, 0),
        soldSeats: chainSoldSeats,
        gross: number(chainRow.gross),
        occupancyPercent: chainTotalSeats
          ? Number(((chainSoldSeats / chainTotalSeats) * 100).toFixed(2))
          : number(chainRow.occupancy),
        ff: number(chainRow.fastfilling),
        hf: number(chainRow.housefull),
        boxofficeShowCount: number(chainRow.shows),
        boxofficeVenueCount: number(chainRow.venues),
        boxofficeSource: {
          method: "bfilmy-chain-summary",
          capturedAt: generatedAt,
          lastUpdated: payload.last_updated || "",
          chain: chainRow.chain
        }
      });
    }
  }

  if (!captures.length) return null;

  const summary = summarize(captures);
  summary.ff = captures.reduce((sum, show) => sum + number(show.ff), 0);
  summary.hf = captures.reduce((sum, show) => sum + number(show.hf), 0);

  return {
    source: "bfilmy-daily-city-summary",
    lastUpdated: payload.last_updated || "",
    generatedAt,
    summary,
    theatres: summarizeByTheatre(venueCaptures),
    movies: summarizeByMovie(captures),
    captures,
    venueCaptures,
    city: CITY
  };
}

async function fetchBfilmyCityFallback({ date, fetchImpl = fetch, generatedAt }) {
  const url = `${BFILMY_DAILY_DATA_BASE_URL}/${isoToDateCode(date)}/finalsummary.json?ts=${Date.now()}`;
  const response = await fetchImpl(url, {
    cache: "no-store",
    headers: {
      accept: "application/json, text/plain, */*",
      referer: "https://bfilmy.pages.dev/Live%20Boxoffice/",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
    }
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`BFilmy city summary failed: ${response.status} ${text.slice(0, 120)}`);
  }

  return buildBfilmyCityFallback({
    date,
    payload: JSON.parse(text),
    generatedAt
  });
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

function buildOutput({ date, existing, captures, plannedShows, errors, generatedAt, bfilmyFallback }) {
  const sortedCaptures = [...captures].sort(compareShows);
  const shouldUseBfilmyFallback = Boolean(bfilmyFallback && errors.length && !sortedCaptures.length);
  const publishedCaptures = shouldUseBfilmyFallback ? [] : sortedCaptures;

  return {
    version: 1,
    generatedAt,
    generatedAtIst: indiaWallClockIso(new Date(generatedAt)),
    targetDate: date,
    targetDateCode: isoToDateCode(date),
    timezone: INDIA_TIMEZONE,
    city: CITY,
    capturePolicy: CAPTURE_POLICY,
    summary: shouldUseBfilmyFallback ? bfilmyFallback.summary : summarize(sortedCaptures),
    theatres: shouldUseBfilmyFallback ? bfilmyFallback.theatres : summarizeByTheatre(sortedCaptures),
    movies: shouldUseBfilmyFallback ? bfilmyFallback.movies : summarizeByMovie(sortedCaptures),
    captures: publishedCaptures,
    partialCaptures: shouldUseBfilmyFallback ? sortedCaptures : [],
    plannedShows: [...plannedShows].sort(compareShows),
    meta: {
      status: errors.length ? (shouldUseBfilmyFallback ? "fallback" : "partial") : "ok",
      source: shouldUseBfilmyFallback ? "bfilmy-daily-city-summary" : "vercel-scheduled-boxoffice",
      previousGeneratedAt: existing?.generatedAt || null,
      errors,
      bfilmyFallback: bfilmyFallback
        ? {
            used: shouldUseBfilmyFallback,
            source: bfilmyFallback.source,
            lastUpdated: bfilmyFallback.lastUpdated,
            totalGross: bfilmyFallback.summary.totalGross,
            totalSold: bfilmyFallback.summary.totalSold,
            totalShows: bfilmyFallback.summary.totalShows,
            movies: bfilmyFallback.movies.length,
            theatreRows: bfilmyFallback.theatres.length
          }
        : null
    }
  };
}

export async function applyBfilmyCityFallback(snapshot, { fetchImpl = fetch, generatedAt = new Date().toISOString() } = {}) {
  const errors = snapshot?.meta?.errors || [];
  if (!snapshot || !errors.length) return snapshot;

  const storedCaptures = snapshot.captures?.length ? snapshot.captures : snapshot.partialCaptures || [];
  if (storedCaptures.length) {
    return buildOutput({
      date: snapshot.targetDate,
      existing: snapshot,
      captures: storedCaptures,
      plannedShows: snapshot.plannedShows || [],
      errors,
      generatedAt: snapshot.generatedAt || generatedAt,
      bfilmyFallback: null
    });
  }

  if (snapshot.meta?.bfilmyFallback?.used && Number(snapshot.meta?.bfilmyFallback?.theatreRows || 0) > 0) {
    return {
      ...snapshot,
      captures: [],
      partialCaptures: snapshot.partialCaptures || snapshot.captures || []
    };
  }

  const bfilmyFallback = await fetchBfilmyCityFallback({
    date: snapshot.targetDate,
    fetchImpl,
    generatedAt
  });
  if (!bfilmyFallback) return snapshot;

  return buildOutput({
    date: snapshot.targetDate,
    existing: snapshot,
    captures: snapshot.captures || [],
    plannedShows: snapshot.plannedShows || [],
    errors,
    generatedAt,
    bfilmyFallback
  });
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

  applyManualPlanOverride({
    plannedByKey,
    date,
    theatres,
    notes: errors
  });
  refreshPlannedCapturePolicies({
    plannedByKey,
    theatres
  });

  let bfilmyFallback = null;
  if (errors.length) {
    try {
      bfilmyFallback = await fetchBfilmyCityFallback({ date, fetchImpl, generatedAt });
    } catch (error) {
      errors.push(`BFilmy city summary: ${error.message}`);
    }
  }

  const data = buildOutput({
    date,
    existing,
    captures: Array.from(capturesByKey.values()),
    plannedShows: Array.from(plannedByKey.values()),
    errors,
    generatedAt,
    bfilmyFallback
  });

  return writeBoxofficeSnapshot(data);
}
