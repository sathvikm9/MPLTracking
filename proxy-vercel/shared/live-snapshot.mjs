import { fetchMadanapalleShowtimesPayload } from "./madanapalle-showtimes.mjs";
import {
  discoverTheatreDates,
  discoverTheatreDateShows,
  MADANAPALLE_THEATRES
} from "./theatre-discovery.mjs";

export const DEFAULT_SNAPSHOT_BASE_URL = "https://sathvikm9.github.io/MPLTracking/data";
const DEFAULT_FUTURE_SCAN_DAYS = 9;
const MAX_FUTURE_SCAN_DAYS = 21;
const MADANAPALLE_EVENT_SEARCH_URL = "https://search.contactbfilmy.workers.dev/";
const EVENT_CATALOG_CACHE_MAX_AGE_MS = 1000 * 60 * 15;
const MADANAPALLE_SEED_EVENTS = [
  {
    eventCode: "ET00434252",
    title: "Sathi Leelavathi"
  },
  {
    eventCode: "ET00455003",
    title: "Veerabhadrudu"
  },
  {
    eventCode: "ET00342988",
    title: "KD (Telugu)"
  },
  {
    eventCode: "ET00496966",
    title: "Kara (Telugu)"
  },
  {
    eventCode: "ET00493691",
    title: "Harudu"
  },
  {
    eventCode: "ET00301010",
    title: "Krishna"
  },
  {
    eventCode: "ET00355891",
    title: "Andhrawala"
  },
  {
    eventCode: "ET00495010",
    title: "Godari Gattupaina"
  },
  {
    eventCode: "ET00488038",
    title: "Mr. Work From Home"
  }
];

const eventCatalogCache = globalThis.__MADANAPALLE_EVENT_CATALOG_CACHE__ || {
  cachedAtMs: 0,
  movies: []
};
globalThis.__MADANAPALLE_EVENT_CATALOG_CACHE__ = eventCatalogCache;

const MADANAPALLE_VISIBLE_DATE_SEEDS = [
  ["RTDM", "2026-05-15", 4, "Veerabhadrudu"],
  ["RTDM", "2026-05-16", 4, "Veerabhadrudu"],
  ["RTDM", "2026-05-17", 4, "Veerabhadrudu"],
  ["RTDM", "2026-05-18", 4, "Veerabhadrudu"],
  ["RTDM", "2026-05-19", 4, "Veerabhadrudu"],
  ["RTDM", "2026-05-20", 5, "Veerabhadrudu, Oosaravelli"],
  ["RTDM", "2026-05-21", 4, "Veerabhadrudu"],
  ["ASRM", "2026-05-14", 1, "Sathi Leelavathi"],
  ["ASRM", "2026-05-15", 4, "KD (Telugu)"],
  ["ASRM", "2026-05-16", 4, "KD (Telugu)"],
  ["ASRM", "2026-05-17", 4, "KD (Telugu)"],
  ["ASRM", "2026-05-18", 4, "KD (Telugu)"],
  ["ASRM", "2026-05-19", 4, "KD (Telugu)"],
  ["ASRM", "2026-05-20", 5, "KD (Telugu), Oosaravelli"],
  ["ASRM", "2026-05-21", 4, "KD (Telugu)"],
  ["MSDR", "2026-05-14", 1, "Kara (Telugu)"],
  ["MSDR", "2026-05-15", 4, "Harudu"],
  ["MSDR", "2026-05-16", 4, "Krishna, Harudu"],
  ["MSDR", "2026-05-17", 4, "Krishna, Harudu"],
  ["MSDR", "2026-05-18", 4, "Krishna, Harudu"],
  ["MSDR", "2026-05-19", 4, "Krishna, Harudu"],
  ["MSDR", "2026-05-20", 5, "Andhrawala, Krishna, Harudu"],
  ["MSDR", "2026-05-21", 4, "Krishna, Harudu"],
  ["SKMD", "2026-05-14", 1, "Godari Gattupaina"],
  ["SKMD", "2026-05-15", 4, "Mr. Work From Home, Godari Gattupaina"],
  ["SKMD", "2026-05-16", 4, "Mr. Work From Home, Godari Gattupaina"],
  ["SKMD", "2026-05-17", 4, "Mr. Work From Home, Godari Gattupaina"]
];

const MADANAPALLE_VISIBLE_EVENT_SEEDS = [
  ["RTDM", "2026-05-15", ["ET00455003"]],
  ["RTDM", "2026-05-16", ["ET00455003"]],
  ["RTDM", "2026-05-17", ["ET00455003"]],
  ["RTDM", "2026-05-18", ["ET00455003"]],
  ["RTDM", "2026-05-19", ["ET00455003"]],
  ["RTDM", "2026-05-20", ["ET00007926", "ET00455003"]],
  ["RTDM", "2026-05-21", ["ET00455003"]],
  ["ASRM", "2026-05-14", ["ET00434252"]],
  ["ASRM", "2026-05-15", ["ET00342988"]],
  ["ASRM", "2026-05-16", ["ET00342988"]],
  ["ASRM", "2026-05-17", ["ET00342988"]],
  ["ASRM", "2026-05-18", ["ET00342988"]],
  ["ASRM", "2026-05-19", ["ET00342988"]],
  ["ASRM", "2026-05-20", ["ET00007926", "ET00342988"]],
  ["ASRM", "2026-05-21", ["ET00342988"]],
  ["MSDR", "2026-05-14", ["ET00496966"]],
  ["MSDR", "2026-05-15", ["ET00493691"]],
  ["MSDR", "2026-05-16", ["ET00301010", "ET00493691"]],
  ["MSDR", "2026-05-17", ["ET00301010", "ET00493691"]],
  ["MSDR", "2026-05-18", ["ET00301010", "ET00493691"]],
  ["MSDR", "2026-05-19", ["ET00301010", "ET00493691"]],
  ["MSDR", "2026-05-20", ["ET00355891", "ET00301010", "ET00493691"]],
  ["MSDR", "2026-05-21", ["ET00301010", "ET00493691"]],
  ["SKMD", "2026-05-14", ["ET00495010"]],
  ["SKMD", "2026-05-15", ["ET00488038", "ET00495010"]],
  ["SKMD", "2026-05-16", ["ET00488038", "ET00495010"]],
  ["SKMD", "2026-05-17", ["ET00488038", "ET00495010"]]
];

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === null || value === undefined || value === "") return 0;

  const cleaned = String(value).replace(/[^\d.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoToDateCode(date) {
  return String(date || "").replaceAll("-", "");
}

function eventCodeFromMovie(movie) {
  return String(movie?.id || movie?.eventCode || movie?.DefaultEventCode || "").trim().toUpperCase();
}

function dateCodeToIso(dateCode) {
  const value = String(dateCode || "");
  if (!/^\d{8}$/.test(value)) return "";
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function showDateTimeToIso(value) {
  const code = String(value || "");
  if (!/^\d{12}$/.test(code)) return "";
  return `${code.slice(0, 4)}-${code.slice(4, 6)}-${code.slice(6, 8)}T${code.slice(
    8,
    10
  )}:${code.slice(10, 12)}:00+05:30`;
}

function getIndiaTodayIso() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.format(new Date());
}

function addDaysIso(dateIso, days) {
  const [year, month, day] = String(dateIso).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function normalizeMovieGenres(eventGenre) {
  if (!eventGenre) return [];
  if (Array.isArray(eventGenre)) return eventGenre;
  if (typeof eventGenre === "string") return eventGenre.split("|").filter(Boolean);
  if (typeof eventGenre === "object") {
    return Object.keys(eventGenre).filter((key) => key !== "GenreMeta");
  }
  return [];
}

function normalizeAvailabilityCategories(rawCategories) {
  const categories = Array.isArray(rawCategories) ? rawCategories : [];

  return categories.map((category) => {
    const price = toNumber(category.CurPrice || category.price || category.Price || 0);
    const totalSeats = toNumber(category.MaxSeats || category.totalSeats || 0);
    const availableSeats = toNumber(category.SeatsAvail || category.availableSeats || 0);
    const soldSeats = Math.max(totalSeats - availableSeats, 0);

    return {
      name: category.PriceDesc || category.name || "Category",
      label: category.label || category.PriceDesc || category.name || "Category",
      price,
      totalSeats,
      availableSeats,
      soldSeats,
      unknownSeats: 0,
      rows: []
    };
  });
}

function hasAvailabilityMetrics(categories) {
  return categories.some(
    (category) => category.totalSeats > 0 || category.availableSeats > 0 || category.soldSeats > 0
  );
}

function netTicketPrice(price) {
  return Math.max(toNumber(price) - 5, 0);
}

function buildSnapshotFromCategories(show, categories, method) {
  const totalSeats = categories.reduce((sum, category) => sum + category.totalSeats, 0);
  const availableSeats = categories.reduce((sum, category) => sum + category.availableSeats, 0);
  const soldSeats = categories.reduce((sum, category) => sum + category.soldSeats, 0);
  const unknownSeats = categories.reduce((sum, category) => sum + category.unknownSeats, 0);
  const gross = categories.reduce(
    (sum, category) => sum + category.soldSeats * netTicketPrice(category.price),
    0
  );

  return {
    ...show,
    categories: categories.map((category) => ({
      ...category,
      netPrice: netTicketPrice(category.price)
    })),
    totalSeats,
    availableSeats,
    soldSeats,
    unknownSeats,
    gross,
    occupancyPercent: totalSeats ? Number(((soldSeats / totalSeats) * 100).toFixed(2)) : 0,
    source: {
      method,
      capturedAt: new Date().toISOString()
    }
  };
}

function buildShowIndex(shows) {
  return new Map(
    shows.map((show) => [
      `${show.venueCode}-${show.sessionId}`,
      show
    ])
  );
}

function buildTheatreMap(shows, theatres) {
  const showMap = new Map();

  for (const show of shows) {
    showMap.set(show.venueCode, {
      venueCode: show.venueCode,
      shortName: show.theatreShortName,
      name: show.venueName
    });
  }

  for (const theatre of theatres || []) {
    if (showMap.has(theatre.venueCode)) continue;
    showMap.set(theatre.venueCode, {
      venueCode: theatre.venueCode,
      shortName: theatre.shortName,
      name: theatre.name
    });
  }

  return showMap;
}

function buildApiSnapshotsFromPayload(payload, theatreMap, baseShowIndex, targetDateCode = "") {
  const snapshots = [];
  const showDetails = Array.isArray(payload?.ShowDetails) ? payload.ShowDetails : [];

  for (const showDetail of showDetails) {
    if (targetDateCode && showDetail?.Date && String(showDetail.Date) !== targetDateCode) {
      continue;
    }

    const childEvents = Array.isArray(showDetail?.Event?.ChildEvents) ? showDetail.Event.ChildEvents : [];
    const childEventsByCode = new Map(
      childEvents
        .filter((childEvent) => childEvent?.EventCode)
        .map((childEvent) => [childEvent.EventCode, childEvent])
    );
    const venues = Array.isArray(showDetail?.Venues) ? showDetail.Venues : [];

    for (const venue of venues) {
      const theatre = theatreMap.get(venue?.VenueCode);
      if (!theatre) continue;

      const showTimes = Array.isArray(venue?.ShowTimes) ? venue.ShowTimes : [];
      for (const showTime of showTimes) {
        const showDateCode = String(showTime.ShowDateCode || showDetail.Date || "");
        if (targetDateCode && showDateCode && showDateCode !== targetDateCode) continue;

        const baseShow = baseShowIndex.get(`${venue.VenueCode}-${showTime.SessionId}`);
        if (!baseShow) continue;

        const childEvent =
          childEventsByCode.get(showTime.EventCode) || childEvents[0] || showDetail?.Event || {};
        const categories = normalizeAvailabilityCategories(showTime.Categories);

        if (!hasAvailabilityMetrics(categories)) continue;

        snapshots.push(
          buildSnapshotFromCategories(
            {
              ...baseShow,
              title:
                childEvent.EventName ||
                childEvent.EventTitle ||
                baseShow.title ||
                "Untitled Movie",
              releaseLabel:
                showDetail?.Event?.EventTitle || childEvent.EventTitle || baseShow.releaseLabel || "",
              language: childEvent.EventLang || baseShow.language || "",
              format: childEvent.EventDimension || baseShow.format || "",
              censor: childEvent.EventCensor || baseShow.censor || "",
              genres:
                normalizeMovieGenres(childEvent.EventGenre || showDetail?.Event?.EventGenre) ||
                baseShow.genres ||
                []
            },
            categories,
            "live-proxy-showtimes"
          )
        );
      }
    }
  }

  return snapshots;
}

function buildDiscoverySnapshotsFromPayload(payload, theatreMap, targetDateCode = "") {
  const snapshots = [];
  const showDetails = Array.isArray(payload?.ShowDetails) ? payload.ShowDetails : [];

  for (const showDetail of showDetails) {
    if (targetDateCode && showDetail?.Date && String(showDetail.Date) !== targetDateCode) continue;

    const childEvents = Array.isArray(showDetail?.Event?.ChildEvents) ? showDetail.Event.ChildEvents : [];
    const childEventsByCode = new Map(
      childEvents
        .filter((childEvent) => childEvent?.EventCode)
        .map((childEvent) => [childEvent.EventCode, childEvent])
    );
    const venues = Array.isArray(showDetail?.Venues) ? showDetail.Venues : [];

    for (const venue of venues) {
      const theatre = theatreMap.get(venue?.VenueCode);
      if (!theatre) continue;

      const showTimes = Array.isArray(venue?.ShowTimes) ? venue.ShowTimes : [];
      for (const showTime of showTimes) {
        const showDateCode = String(showTime.ShowDateCode || showDetail.Date || "");
        if (targetDateCode && showDateCode && showDateCode !== targetDateCode) continue;

        const childEvent =
          childEventsByCode.get(showTime.EventCode) || childEvents[0] || showDetail?.Event || {};
        const categories = normalizeAvailabilityCategories(showTime.Categories);
        const eventCode = showTime.EventCode || childEvent.EventCode || showDetail?.Event?.EventCode;

        if (!eventCode || !showTime.SessionId || !hasAvailabilityMetrics(categories)) continue;

        snapshots.push(
          buildSnapshotFromCategories(
            {
              id: `${theatre.venueCode}-${showTime.SessionId}`,
              eventCode,
              sessionId: showTime.SessionId,
              venueCode: theatre.venueCode,
              venueName: theatre.name,
              theatreShortName: theatre.shortName,
              citySlug: "madanapalle",
              showDate: dateCodeToIso(showDateCode),
              showDateCode,
              showDateTime: showDateTimeToIso(showTime.ShowDateTime),
              showDateTimeCode: showTime.ShowDateTime,
              showTimeLabel: showTime.ShowTime,
              cutoffAt: showDateTimeToIso(showTime.CutOffDateTime),
              cutoffCode: showTime.CutOffDateTime || null,
              format: childEvent.EventDimension || "",
              language: childEvent.EventLang || "",
              title:
                childEvent.EventName ||
                childEvent.EventTitle ||
                showDetail?.Event?.EventTitle ||
                "Untitled Movie",
              releaseLabel: showDetail?.Event?.EventTitle || childEvent.EventTitle || "",
              censor: childEvent.EventCensor || "",
              genres: normalizeMovieGenres(childEvent.EventGenre || showDetail?.Event?.EventGenre),
              trailerUrl: childEvent.TrailerUrl || childEvent.EventTrailer || "",
              screenName: showTime.ScreenName || theatre.shortName,
              bookingUrl: "",
              seatLayoutUrl: ""
            },
            categories,
            "live-proxy-discovery"
          )
        );
      }
    }
  }

  return snapshots;
}

function normalizeDiscoveredCategories(rawCategories) {
  const categories = Array.isArray(rawCategories) ? rawCategories : [];

  return categories.map((category) => ({
    name: category.PriceDesc || category.name || "Category",
    label: category.label || category.PriceDesc || category.name || "Category",
    price: toNumber(category.CurPrice || category.price || category.Price || 0),
    totalSeats: toNumber(category.MaxSeats || category.totalSeats || 0),
    availableSeats: toNumber(category.SeatsAvail || category.availableSeats || 0),
    soldSeats: Math.max(
      toNumber(category.MaxSeats || category.totalSeats || 0) -
        toNumber(category.SeatsAvail || category.availableSeats || 0),
      0
    ),
    unknownSeats: 0,
    rows: []
  }));
}

function buildSnapshotsFromTheatreShows(shows) {
  return (shows || []).map((show) =>
    buildSnapshotFromCategories(
      show,
      normalizeDiscoveredCategories(show.rawCategories),
      "bookmyshow-theatre-page"
    )
  );
}

function summarizeByMovie(shows) {
  const map = new Map();

  for (const show of shows) {
    if (!map.has(show.eventCode)) {
      map.set(show.eventCode, {
        eventCode: show.eventCode,
        title: show.releaseLabel || show.title,
        displayTitle: show.title,
        language: show.language,
        format: show.format,
        censor: show.censor,
        genres: show.genres,
        totalShows: 0,
        totalCapacity: 0,
        totalAvailable: 0,
        totalSold: 0,
        totalGross: 0,
        venueCodes: new Set()
      });
    }

    const entry = map.get(show.eventCode);
    entry.totalShows += 1;
    entry.totalCapacity += show.totalSeats;
    entry.totalAvailable += show.availableSeats;
    entry.totalSold += show.soldSeats;
    entry.totalGross += show.gross;
    entry.venueCodes.add(show.venueCode);
  }

  return Array.from(map.values())
    .map((entry) => ({
      ...entry,
      venueCount: entry.venueCodes.size,
      occupancyPercent: entry.totalCapacity
        ? Number(((entry.totalSold / entry.totalCapacity) * 100).toFixed(2))
        : 0
    }))
    .sort((left, right) => right.totalSold - left.totalSold);
}

function summarizeByTheatre(shows) {
  const map = new Map();

  for (const show of shows) {
    if (!map.has(show.venueCode)) {
      map.set(show.venueCode, {
        venueCode: show.venueCode,
        name: show.venueName,
        shortName: show.theatreShortName,
        totalShows: 0,
        totalCapacity: 0,
        totalAvailable: 0,
        totalSold: 0,
        totalGross: 0
      });
    }

    const entry = map.get(show.venueCode);
    entry.totalShows += 1;
    entry.totalCapacity += show.totalSeats;
    entry.totalAvailable += show.availableSeats;
    entry.totalSold += show.soldSeats;
    entry.totalGross += show.gross;
  }

  return Array.from(map.values())
    .map((entry) => ({
      ...entry,
      occupancyPercent: entry.totalCapacity
        ? Number(((entry.totalSold / entry.totalCapacity) * 100).toFixed(2))
        : 0
    }))
    .sort((left, right) => right.totalSold - left.totalSold);
}

function buildSummary(shows) {
  const totalShows = shows.length;
  const totalCapacity = shows.reduce((sum, show) => sum + show.totalSeats, 0);
  const totalAvailable = shows.reduce((sum, show) => sum + show.availableSeats, 0);
  const totalSold = shows.reduce((sum, show) => sum + show.soldSeats, 0);
  const totalGross = shows.reduce((sum, show) => sum + show.gross, 0);

  return {
    totalShows,
    totalCapacity,
    totalAvailable,
    totalSold,
    totalGross,
    occupancyPercent: totalCapacity
      ? Number(((totalSold / totalCapacity) * 100).toFixed(2))
      : 0
  };
}

function buildOutputFromBaseline(baseline, shows, notes = []) {
  return {
    version: baseline.version || 1,
    generatedAt: new Date().toISOString(),
    generatedAtLabel: new Intl.DateTimeFormat("en-IN", {
      timeZone: baseline.timezone || "Asia/Kolkata",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date()),
    targetDate: baseline.targetDate,
    targetDateCode: baseline.targetDateCode,
    timezone: baseline.timezone,
    city: baseline.city,
    summary: buildSummary(shows),
    movies: summarizeByMovie(shows),
    theatres: summarizeByTheatre(shows),
    shows: [...shows].sort((left, right) => left.showDateTime.localeCompare(right.showDateTime)),
    meta: {
      ...(baseline.meta || {}),
      status: "ok",
      notes,
      liveProxy: true
    }
  };
}

function buildEmptyOutputFromBaseline(baseline, targetDate, notes = []) {
  const targetDateCode = String(targetDate || baseline.targetDate || "").replaceAll("-", "");

  return {
    version: baseline.version || 1,
    generatedAt: new Date().toISOString(),
    generatedAtLabel: new Intl.DateTimeFormat("en-IN", {
      timeZone: baseline.timezone || "Asia/Kolkata",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date()),
    targetDate: targetDate || baseline.targetDate,
    targetDateCode,
    timezone: baseline.timezone,
    city: baseline.city,
    summary: buildSummary([]),
    movies: [],
    theatres: [],
    shows: [],
    meta: {
      ...(baseline.meta || {}),
      status: "ok",
      notes,
      liveProxy: true
    }
  };
}

function filterOutputByVenueCode(output, venueCode) {
  if (!venueCode) return output;

  const shows = (output.shows || []).filter((show) => show.venueCode === venueCode);
  const notes = [...(output.meta?.notes || [])];
  const liveShowCount = shows.filter((show) => show.source?.method === "live-proxy-showtimes").length;

  if (!shows.length) {
    notes.push(`No shows were found for selected theatre ${venueCode}.`);
  }

  return {
    ...output,
    summary: buildSummary(shows),
    movies: summarizeByMovie(shows),
    theatres: summarizeByTheatre(shows),
    shows,
    meta: {
      ...(output.meta || {}),
      selectedVenueCode: venueCode,
      liveRefresh: output.meta?.liveRefresh
        ? {
            ...output.meta.liveRefresh,
            liveShowCount,
            fallbackShowCount: shows.length - liveShowCount
          }
        : undefined,
      notes
    }
  };
}

function filterBaselineByVenueCode(baseline, venueCode) {
  if (!venueCode) return baseline;

  return {
    ...baseline,
    shows: (baseline.shows || []).filter((show) => show.venueCode === venueCode),
    theatres: (baseline.theatres || []).filter((theatre) => theatre.venueCode === venueCode)
  };
}

async function fetchBaselineSnapshot(fetchImpl, baseUrl, date) {
  const normalizedBaseUrl = String(baseUrl || DEFAULT_SNAPSHOT_BASE_URL).replace(/\/$/, "");
  const fileName = date && date !== "today" ? `history/${date}.json` : "latest.json";
  const url = `${normalizedBaseUrl}/${fileName}?ts=${Date.now()}`;
  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    const error = new Error(`Failed to load baseline snapshot: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

async function fetchDateManifest(fetchImpl, baseUrl) {
  const normalizedBaseUrl = String(baseUrl || DEFAULT_SNAPSHOT_BASE_URL).replace(/\/$/, "");
  const response = await fetchImpl(`${normalizedBaseUrl}/dates.json?ts=${Date.now()}`, {
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    const error = new Error(`Failed to load date manifest: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

function eventCodesFromManifest(manifest) {
  const eventCodes = new Set();

  for (const dateEntry of manifest?.dates || []) {
    for (const movie of dateEntry.movies || []) {
      if (movie?.eventCode) eventCodes.add(movie.eventCode);
    }
  }

  return [...eventCodes].sort();
}

async function fetchMadanapalleEventCatalog(fetchImpl) {
  const cacheAgeMs = Date.now() - Number(eventCatalogCache.cachedAtMs || 0);
  if (eventCatalogCache.movies.length && cacheAgeMs < EVENT_CATALOG_CACHE_MAX_AGE_MS) {
    return {
      movies: eventCatalogCache.movies,
      cache: {
        hit: true,
        ageMs: cacheAgeMs
      }
    };
  }

  const url = new URL(MADANAPALLE_EVENT_SEARCH_URL);
  url.searchParams.set("r", "MDNP");
  url.searchParams.set("_", String(Date.now()));

  const response = await fetchImpl(url, {
    cache: "no-store",
    headers: {
      accept: "application/json, text/plain, */*",
      origin: "https://boxoffice24.pages.dev",
      referer: "https://boxoffice24.pages.dev/",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
    }
  });

  if (!response.ok) {
    throw new Error(`Madanapalle event catalog failed: ${response.status}`);
  }

  const payload = await response.json();
  const movies = (payload.movies || [])
    .map((movie) => ({
      eventCode: eventCodeFromMovie(movie),
      title: movie.name || movie.Title || movie.title || "",
      slug: movie.slug || "",
      releaseDate: movie.releaseDate || movie.EventDate || "",
      status: movie.status || ""
    }))
    .filter((movie) => /^ET\d+$/i.test(movie.eventCode));

  for (const seed of MADANAPALLE_SEED_EVENTS) {
    if (!movies.some((movie) => movie.eventCode === seed.eventCode)) {
      movies.push({
        eventCode: seed.eventCode,
        title: seed.title,
        slug: "",
        releaseDate: "",
        status: "Seed"
      });
    }
  }

  eventCatalogCache.movies = movies;
  eventCatalogCache.cachedAtMs = Date.now();

  return {
    movies,
    cache: {
      hit: false,
      ageMs: 0
    }
  };
}

async function eventCodesFromMadanapalleCatalog(fetchImpl, notes = []) {
  try {
    const catalog = await fetchMadanapalleEventCatalog(fetchImpl);
    const seedCodes = MADANAPALLE_SEED_EVENTS.map((movie) => movie.eventCode);
    const discoveredCodes = catalog.movies.map((movie) => movie.eventCode);
    const eventCodes = [...new Set([...seedCodes, ...discoveredCodes])].filter(Boolean);
    if (!eventCodes.length) {
      notes.push("Madanapalle event catalog returned no current BookMyShow movies.");
    }
    return {
      eventCodes,
      catalog
    };
  } catch (error) {
    notes.push(`Madanapalle event catalog failed: ${error.message}`);
    return {
      eventCodes: [],
      catalog: {
        movies: [],
        cache: {
          hit: false
        }
      }
    };
  }
}

function buildDiscoveryBaseline(seedBaseline, targetDate) {
  const targetDateCode = isoToDateCode(targetDate);

  return {
    ...(seedBaseline || {}),
    version: seedBaseline?.version || 1,
    generatedAt: new Date().toISOString(),
    targetDate,
    targetDateCode,
    timezone: seedBaseline?.timezone || "Asia/Kolkata",
    city: seedBaseline?.city || {
      name: "Madanapalle",
      regionCode: "MDNP",
      timezone: "Asia/Kolkata"
    },
    shows: [],
    theatres: MADANAPALLE_THEATRES,
    meta: {
      ...(seedBaseline?.meta || {}),
      status: "ok"
    }
  };
}

async function discoverLiveShowsForDate({
  fetchImpl,
  snapshotBaseUrl,
  targetDate,
  venueCode = "",
  seedBaseline = null,
  retryRounds,
  eventCodes: providedEventCodes = null
}) {
  const notes = [];
  const targetDateCode = isoToDateCode(targetDate);
  const theatreMap = new Map(MADANAPALLE_THEATRES.map((theatre) => [theatre.venueCode, theatre]));
  const snapshotsById = new Map();
  const successfulEventCodes = [];
  const failedEventCodes = [];
  const cachedEventCodes = [];
  let eventCodes = Array.isArray(providedEventCodes) ? providedEventCodes : [];

  if (!eventCodes.length) {
    const catalog = await eventCodesFromMadanapalleCatalog(fetchImpl, notes);
    eventCodes = catalog.eventCodes;
  }

  if (!eventCodes.length) {
    try {
      eventCodes = eventCodesFromManifest(await fetchDateManifest(fetchImpl, snapshotBaseUrl));
    } catch (error) {
      notes.push(`Static event manifest could not load: ${error.message}`);
    }
  }

  if (!eventCodes.length && seedBaseline?.shows?.length) {
    eventCodes = [...new Set(seedBaseline.shows.map((show) => show.eventCode).filter(Boolean))];
  }

  for (const eventCode of eventCodes) {
    try {
      const { payload, meta } = await fetchMadanapalleShowtimesPayload({
        eventCode,
        dateCode: targetDateCode,
        venueCode,
        retryRounds,
        fetchImpl
      });

      if (meta?.cache?.hit) cachedEventCodes.push(eventCode);

      for (const snapshot of buildDiscoverySnapshotsFromPayload(payload, theatreMap, targetDateCode)) {
        snapshotsById.set(snapshot.id, snapshot);
      }

      successfulEventCodes.push(eventCode);
    } catch (error) {
      failedEventCodes.push(eventCode);
    }
  }

  const baseline = buildDiscoveryBaseline(seedBaseline, targetDate);
  if (failedEventCodes.length && snapshotsById.size === 0) {
    notes.push(
      `Live discovery could not fetch seat counts for ${failedEventCodes.length} catalog movies.`
    );
  }
  const output = buildOutputFromBaseline(baseline, Array.from(snapshotsById.values()), notes);
  const liveShowCount = output.shows.filter(
    (show) => show.source?.method === "live-proxy-discovery"
  ).length;

  return filterOutputByVenueCode(
    {
      ...output,
      meta: {
        ...(output.meta || {}),
        liveDiscovery: true,
        source: "madanapalle-event-catalog",
        liveRefresh: {
          attemptedEvents: eventCodes.length,
          successfulEvents: successfulEventCodes.length,
          failedEvents: failedEventCodes.length,
          failedEventCodes,
          cachedEvents: cachedEventCodes.length,
          cachedEventCodes,
          liveShowCount,
          fallbackShowCount: output.shows.length - liveShowCount
        }
      }
    },
    venueCode
  );
}

async function buildLiveOutputFromTheatreDiscovery({
  discovered,
  fetchImpl,
  targetDate,
  venueCode
}) {
  const notes = [...(discovered.meta?.notes || [])];
  const baseShows = buildSnapshotsFromTheatreShows(discovered.shows || []);
  const baseShowIndex = buildShowIndex(baseShows);
  const theatreMap = buildTheatreMap(baseShows, MADANAPALLE_THEATRES);
  const snapshotsById = new Map(baseShows.map((show) => [show.id, show]));
  const eventCodes = [...new Set(baseShows.map((show) => show.eventCode).filter(Boolean))];
  const successfulEventCodes = [];
  const failedEventCodes = [];
  const cachedEventCodes = [];
  const targetDateCode = isoToDateCode(targetDate);

  await Promise.all(
    eventCodes.map(async (eventCode) => {
      try {
        const { payload, meta } = await fetchMadanapalleShowtimesPayload({
          eventCode,
          dateCode: targetDateCode,
          venueCode,
          retryRounds: 1,
          fetchImpl
        });

        if (meta?.cache?.hit) cachedEventCodes.push(eventCode);

        for (const snapshot of buildApiSnapshotsFromPayload(
          payload,
          theatreMap,
          baseShowIndex,
          targetDateCode
        )) {
          snapshotsById.set(snapshot.id, snapshot);
        }

        successfulEventCodes.push(eventCode);
      } catch (error) {
        failedEventCodes.push(eventCode);
        notes.push(`Live seat-count refresh failed for ${eventCode}: ${error.message}`);
      }
    })
  );

  const output = buildOutputFromBaseline(
    buildDiscoveryBaseline(null, targetDate),
    Array.from(snapshotsById.values()),
    notes
  );
  const liveShowCount = output.shows.filter(
    (show) => show.source?.method === "live-proxy-showtimes"
  ).length;

  return {
    ...output,
    meta: {
      ...(output.meta || {}),
      source: "bookmyshow-theatre-page",
      liveDiscovery: true,
      cache: discovered.meta?.cache || {
        hit: false
      },
      pageTitle: discovered.meta?.pageTitle,
      selectedVenueCode: venueCode,
      liveRefresh: {
        attemptedEvents: eventCodes.length,
        successfulEvents: successfulEventCodes.length,
        failedEvents: failedEventCodes.length,
        failedEventCodes,
        cachedEvents: cachedEventCodes.length,
        cachedEventCodes,
        liveShowCount,
        fallbackShowCount: output.shows.length - liveShowCount
      }
    }
  };
}

async function buildTheatreLiveSnapshot({ date, venueCode, fetchImpl }) {
  if (venueCode) {
    const discovered = await discoverTheatreDateShows({
      venueCode,
      date
    });
    return buildLiveOutputFromTheatreDiscovery({
      discovered,
      fetchImpl,
      targetDate: date,
      venueCode
    });
  }

  const theatreOutputs = await Promise.all(
    MADANAPALLE_THEATRES.map(async (theatre) => {
      const discovered = await discoverTheatreDateShows({
        venueCode: theatre.venueCode,
        date
      });
      return buildLiveOutputFromTheatreDiscovery({
        discovered,
        fetchImpl,
        targetDate: date,
        venueCode: theatre.venueCode
      });
    })
  );
  const shows = theatreOutputs.flatMap((output) => output.shows || []);
  const notes = theatreOutputs.flatMap((output) => output.meta?.notes || []);
  const output = buildOutputFromBaseline(buildDiscoveryBaseline(null, date), shows, notes);

  return {
    ...output,
    meta: {
      ...(output.meta || {}),
      source: "bookmyshow-theatre-page",
      liveDiscovery: true,
      cache: {
        hit: theatreOutputs.some((output) => output.meta?.cache?.hit)
      },
      liveRefresh: {
        attemptedEvents: theatreOutputs.reduce(
          (sum, output) => sum + Number(output.meta?.liveRefresh?.attemptedEvents || 0),
          0
        ),
        successfulEvents: theatreOutputs.reduce(
          (sum, output) => sum + Number(output.meta?.liveRefresh?.successfulEvents || 0),
          0
        ),
        failedEvents: theatreOutputs.reduce(
          (sum, output) => sum + Number(output.meta?.liveRefresh?.failedEvents || 0),
          0
        ),
        failedEventCodes: theatreOutputs.flatMap(
          (output) => output.meta?.liveRefresh?.failedEventCodes || []
        ),
        cachedEvents: theatreOutputs.reduce(
          (sum, output) => sum + Number(output.meta?.liveRefresh?.cachedEvents || 0),
          0
        ),
        cachedEventCodes: theatreOutputs.flatMap(
          (output) => output.meta?.liveRefresh?.cachedEventCodes || []
        ),
        liveShowCount: shows.filter((show) => show.source?.method === "live-proxy-showtimes")
          .length,
        fallbackShowCount: shows.filter((show) => show.source?.method !== "live-proxy-showtimes")
          .length
      }
    }
  };
}

async function buildCatalogLiveSnapshot({ date, venueCode, fetchImpl, snapshotBaseUrl }) {
  const notes = [];
  const seededEventCodes = seededEventCodesForVenueDate(venueCode, date);
  const { eventCodes: catalogEventCodes, catalog } = await eventCodesFromMadanapalleCatalog(
    fetchImpl,
    notes
  );
  const eventCodes = seededEventCodes.length ? seededEventCodes : catalogEventCodes;
  const output = await discoverLiveShowsForDate({
    fetchImpl,
    snapshotBaseUrl,
    targetDate: date,
    venueCode,
    seedBaseline: null,
    retryRounds: 2,
    eventCodes
  });

  return {
    ...output,
    meta: {
      ...(output.meta || {}),
      source: "madanapalle-event-catalog",
      selectedVenueCode: venueCode || "",
      eventCatalog: {
        attemptedMovies: eventCodes.length,
        seededSelection: Boolean(seededEventCodes.length),
        cache: catalog.cache
      },
      notes: [...notes, ...((output.meta && output.meta.notes) || [])]
    }
  };
}

async function refreshLiveSnapshot(baseline, fetchImpl) {
  const notes = [];
  const baseShows = Array.isArray(baseline?.shows) ? baseline.shows : [];
  const baseShowIndex = buildShowIndex(baseShows);
  const theatreMap = buildTheatreMap(baseShows, baseline?.theatres || []);
  const snapshotsById = new Map();
  const successfulEventCodes = [];
  const failedEventCodes = [];
  const cachedEventCodes = [];

  for (const show of baseShows) {
    snapshotsById.set(show.id, show);
  }

  const uniqueEventCodes = [...new Set(baseShows.map((show) => show.eventCode).filter(Boolean))];
  for (const eventCode of uniqueEventCodes) {
    try {
      const { payload, meta } = await fetchMadanapalleShowtimesPayload({
        eventCode,
        dateCode: baseline.targetDateCode,
        fetchImpl
      });

      if (meta?.cache?.hit) {
        cachedEventCodes.push(eventCode);
      }

      for (const show of baseShows) {
        if (show.eventCode === eventCode) snapshotsById.delete(show.id);
      }

      for (const snapshot of buildApiSnapshotsFromPayload(
        payload,
        theatreMap,
        baseShowIndex,
        baseline.targetDateCode
      )) {
        snapshotsById.set(snapshot.id, snapshot);
      }

      successfulEventCodes.push(eventCode);
    } catch (error) {
      failedEventCodes.push(eventCode);
      notes.push(`Live refresh failed for ${eventCode}: ${error.message}`);
    }
  }

  const output = buildOutputFromBaseline(baseline, Array.from(snapshotsById.values()), notes);
  const liveShowCount = output.shows.filter(
    (show) => show.source?.method === "live-proxy-showtimes"
  ).length;

  return {
    ...output,
    meta: {
      ...(output.meta || {}),
      liveRefresh: {
        attemptedEvents: uniqueEventCodes.length,
        successfulEvents: successfulEventCodes.length,
        failedEvents: failedEventCodes.length,
        failedEventCodes,
        cachedEvents: cachedEventCodes.length,
        cachedEventCodes,
        liveShowCount,
        fallbackShowCount: output.shows.length - liveShowCount
      }
    }
  };
}

export async function buildLiveSnapshot({
  requestUrl,
  snapshotBaseUrl = DEFAULT_SNAPSHOT_BASE_URL,
  fetchImpl = fetch
}) {
  const url = new URL(requestUrl);
  const date = url.searchParams.get("date") || getIndiaTodayIso();
  const venueCode = url.searchParams.get("venueCode");
  let baseline;

  try {
    return await buildTheatreLiveSnapshot({
      date,
      venueCode,
      fetchImpl
    });
  } catch (error) {
    try {
      const output = await buildCatalogLiveSnapshot({
        date,
        venueCode,
        fetchImpl,
        snapshotBaseUrl
      });

      return {
        ...output,
        meta: {
          ...(output.meta || {}),
          notes: [
            `BookMyShow theatre-page discovery was blocked, so live counts were fetched from the Madanapalle event catalog: ${error.message}`,
            ...((output.meta && output.meta.notes) || [])
          ]
        }
      };
    } catch (catalogError) {
      if (venueCode) {
        const output = buildOutputFromBaseline(buildDiscoveryBaseline(null, date), [], [
          `BookMyShow theatre-page live discovery failed for ${venueCode}: ${error.message}`,
          `Madanapalle event-catalog fallback failed: ${catalogError.message}`
        ]);
        return {
          ...output,
          meta: {
            ...(output.meta || {}),
            source: "bookmyshow-theatre-page",
            liveDiscovery: true,
            selectedVenueCode: venueCode,
            cache: {
              hit: false
            }
          }
        };
      }
    }

    baseline = null;
  }

  try {
    baseline = await fetchBaselineSnapshot(fetchImpl, snapshotBaseUrl, date);
  } catch (error) {
    if (error.status !== 404 || !date || date === "today") {
      throw error;
    }

    const latestBaseline = await fetchBaselineSnapshot(fetchImpl, snapshotBaseUrl, "today");
    const catalog = await eventCodesFromMadanapalleCatalog(fetchImpl);
    const discovered = await discoverLiveShowsForDate({
      fetchImpl,
      snapshotBaseUrl,
      targetDate: date,
      venueCode,
      seedBaseline: latestBaseline,
      eventCodes: catalog.eventCodes
    });

    if (discovered.shows.length) return discovered;

    return filterOutputByVenueCode(
      buildEmptyOutputFromBaseline(latestBaseline, date, [
        `No published baseline was found for ${date}.`,
        "Live discovery found no BookMyShow shows for the selected date."
      ]),
      venueCode
    );
  }

  const scopedBaseline = filterBaselineByVenueCode(baseline, venueCode);
  return filterOutputByVenueCode(await refreshLiveSnapshot(scopedBaseline, fetchImpl), venueCode);
}

function summarizeShowsByTheatre(shows) {
  const map = new Map();

  for (const show of shows) {
    if (!show?.venueCode) continue;

    if (!map.has(show.venueCode)) {
      map.set(show.venueCode, {
        venueCode: show.venueCode,
        name: show.venueName || "",
        shortName: show.theatreShortName || show.venueCode,
        totalShows: 0
      });
    }

    map.get(show.venueCode).totalShows += 1;
  }

  return Array.from(map.values()).sort((left, right) =>
    String(left.shortName).localeCompare(String(right.shortName))
  );
}

function summarizeShowsByMovie(shows) {
  const map = new Map();

  for (const show of shows) {
    if (!show?.eventCode) continue;

    if (!map.has(show.eventCode)) {
      map.set(show.eventCode, {
        eventCode: show.eventCode,
        title: show.releaseLabel || show.title || "Unknown Movie",
        language: show.language || "",
        format: show.format || "",
        totalShows: 0
      });
    }

    map.get(show.eventCode).totalShows += 1;
  }

  return Array.from(map.values()).sort((left, right) =>
    String(left.title).localeCompare(String(right.title))
  );
}

function buildDateManifestEntry(output) {
  const shows = Array.isArray(output?.shows) ? output.shows : [];
  const theatres = summarizeShowsByTheatre(shows);

  return {
    date: output.targetDate,
    dateCode: output.targetDateCode || isoToDateCode(output.targetDate),
    generatedAt: output.generatedAt || "",
    totalShows: shows.length,
    theatres,
    theatreCounts: Object.fromEntries(
      theatres.map((theatre) => [
        theatre.venueCode,
        {
          totalShows: theatre.totalShows,
          shortName: theatre.shortName,
          name: theatre.name
        }
      ])
    ),
    movies: summarizeShowsByMovie(shows)
  };
}

function buildSeedDateManifestEntry({ date, venueCode, totalShows, movieLabel }) {
  const theatre = MADANAPALLE_THEATRES.find((entry) => entry.venueCode === venueCode);
  const movies = String(movieLabel || "")
    .split(",")
    .map((title) => title.trim())
    .filter(Boolean)
    .map((title) => ({
      eventCode: "",
      title,
      displayTitle: title,
      language: "Telugu",
      format: "2D",
      totalShows: 0,
      totalCapacity: 0,
      totalAvailable: 0,
      totalSold: 0,
      totalGross: 0,
      venueCodes: [venueCode]
    }));

  return {
    date,
    dateCode: isoToDateCode(date),
    generatedAt: new Date().toISOString(),
    availabilityOnly: true,
    totalShows,
    theatres: theatre
      ? [
          {
            venueCode,
            name: theatre.name,
            shortName: theatre.shortName,
            totalShows,
            totalCapacity: 0,
            totalAvailable: 0,
            totalSold: 0,
            totalGross: 0,
            occupancyPercent: 0,
            available: true
          }
        ]
      : [],
    theatreCounts: theatre
      ? {
          [venueCode]: {
            totalShows,
            shortName: theatre.shortName,
            name: theatre.name,
            available: true
          }
        }
      : {},
    movies
  };
}

function mergeSeedDateManifestEntries(dates, { venueCode, days }) {
  const today = getIndiaTodayIso();
  const maxDate = addDaysIso(today, days - 1);
  const byDate = new Map((dates || []).map((entry) => [entry.date, entry]));

  for (const [seedVenueCode, date, totalShows, movieLabel] of MADANAPALLE_VISIBLE_DATE_SEEDS) {
    if (venueCode && seedVenueCode !== venueCode) continue;
    if (date < today || date > maxDate) continue;
    if (byDate.has(date)) continue;

    byDate.set(
      date,
      buildSeedDateManifestEntry({
        date,
        venueCode: seedVenueCode,
        totalShows,
        movieLabel
      })
    );
  }

  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function seededEventCodesForVenueDate(venueCode, date) {
  if (!venueCode || !date) return [];

  const entry = MADANAPALLE_VISIBLE_EVENT_SEEDS.find(
    ([seedVenueCode, seedDate]) => seedVenueCode === venueCode && seedDate === date
  );
  return entry ? entry[2] : [];
}

function buildAvailabilityOnlyEntry(dateOption, theatre) {
  const theatreEntry = theatre
    ? {
        venueCode: theatre.venueCode,
        name: theatre.name,
        shortName: theatre.shortName,
        totalShows: 0,
        available: true
      }
    : null;

  return {
    date: dateOption.date,
    dateCode: dateOption.dateCode || isoToDateCode(dateOption.date),
    generatedAt: new Date().toISOString(),
    availabilityOnly: true,
    totalShows: 0,
    theatres: theatreEntry ? [theatreEntry] : [],
    theatreCounts: theatreEntry
      ? {
          [theatreEntry.venueCode]: {
            totalShows: 0,
            shortName: theatreEntry.shortName,
            name: theatreEntry.name,
            available: true
          }
        }
      : {},
    movies: []
  };
}

export async function buildLiveDateManifest({
  requestUrl,
  snapshotBaseUrl = DEFAULT_SNAPSHOT_BASE_URL,
  fetchImpl = fetch
}) {
  const url = new URL(requestUrl);
  const venueCode = url.searchParams.get("venueCode") || "";
  const days = Math.min(
    Math.max(Number(url.searchParams.get("days") || DEFAULT_FUTURE_SCAN_DAYS), 1),
    MAX_FUTURE_SCAN_DAYS
  );
  const discoveredDateEntries = [];

  async function buildCatalogDateManifest(reason = "") {
    const notes = [];
    if (reason) notes.push(reason);
    const { eventCodes, catalog } = await eventCodesFromMadanapalleCatalog(fetchImpl, notes);
    const today = getIndiaTodayIso();
    const theatreMap = new Map(MADANAPALLE_THEATRES.map((theatre) => [theatre.venueCode, theatre]));
    const maxDate = addDaysIso(today, days - 1);
    const snapshotsByDate = new Map();
    let attemptedRequests = 0;
    let successfulRequests = 0;

    for (let offset = 0; offset < days; offset += 1) {
      const targetDate = addDaysIso(today, offset);

      for (const eventCode of eventCodes) {
        attemptedRequests += 1;

        try {
          const { payload } = await fetchMadanapalleShowtimesPayload({
            eventCode,
            dateCode: isoToDateCode(targetDate),
            venueCode,
            retryRounds: 1,
            strictDate: false,
            fetchImpl
          });

          successfulRequests += 1;

          for (const snapshot of buildDiscoverySnapshotsFromPayload(payload, theatreMap, "")) {
            if (venueCode && snapshot.venueCode !== venueCode) continue;
            if (!snapshot.showDate || snapshot.showDate < today || snapshot.showDate > maxDate) continue;

            if (!snapshotsByDate.has(snapshot.showDate)) {
              snapshotsByDate.set(snapshot.showDate, new Map());
            }
            snapshotsByDate.get(snapshot.showDate).set(snapshot.id, snapshot);
          }
        } catch {
          // The public mirror is intermittent; another date/event request may still return data.
        }
      }
    }

    const dates = [...snapshotsByDate.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, snapshots]) =>
        buildDateManifestEntry(
          buildOutputFromBaseline(
            buildDiscoveryBaseline(null, date),
            [...snapshots.values()],
            notes
          )
        )
      );

    const mergedDates = mergeSeedDateManifestEntries(dates, { venueCode, days });

    if (!mergedDates.length && attemptedRequests) {
      notes.push(
        `No live dates were returned by the Madanapalle event catalog after ${attemptedRequests} mirror requests.`
      );
    }

    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      liveDiscovery: true,
      source: "madanapalle-event-catalog",
      venueCode,
      eventCatalog: {
        attemptedMovies: eventCodes.length,
        attemptedRequests,
        successfulRequests,
        cache: catalog.cache
      },
      dates: mergedDates,
      meta: {
        status: "ok",
        notes
      }
    };
  }

  try {
    if (venueCode) {
      const discoveredDates = await discoverTheatreDates({ venueCode, days });
      const outputs = await Promise.all(
        discoveredDates.dateOptions.slice(0, days).map(async (dateOption) => {
          try {
            const discovered =
              dateOption.date === discoveredDates.targetDate && discoveredDates.shows?.length
                ? discoveredDates
                : await discoverTheatreDateShows({
                    venueCode,
                    date: dateOption.date
                  });
            return buildLiveOutputFromTheatreDiscovery({
              discovered,
              fetchImpl,
              targetDate: dateOption.date,
              venueCode
            });
          } catch {
            return buildAvailabilityOnlyEntry(dateOption, discoveredDates.theatre);
          }
        })
      );

      for (const output of outputs) {
        if (output.availabilityOnly) {
          discoveredDateEntries.push(output);
        } else if (output.shows.length) {
          discoveredDateEntries.push(buildDateManifestEntry(output));
        }
      }

      return {
        version: 1,
        generatedAt: new Date().toISOString(),
        liveDiscovery: true,
        source: "bookmyshow-theatre-page",
        venueCode,
        cache: discoveredDates.meta?.cache || {
          hit: false
        },
        dates: discoveredDateEntries
      };
    }

    const theatreDateSets = await Promise.all(
      MADANAPALLE_THEATRES.map((theatre) =>
        discoverTheatreDates({
          venueCode: theatre.venueCode,
          days
        })
      )
    );
    const dateCodes = [
      ...new Set(
        theatreDateSets.flatMap((dateSet) =>
          (dateSet.dateOptions || []).slice(0, days).map((dateOption) => dateOption.date)
        )
      )
    ].sort();

    for (const date of dateCodes) {
      const output = await buildTheatreLiveSnapshot({
        date,
        venueCode: "",
        fetchImpl
      });
      if (output.shows.length) discoveredDateEntries.push(buildDateManifestEntry(output));
    }

    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      liveDiscovery: true,
      source: "bookmyshow-theatre-page",
      venueCode,
      cache: {
        hit: theatreDateSets.some((dateSet) => dateSet.meta?.cache?.hit)
      },
      dates: discoveredDateEntries
    };
  } catch (error) {
    try {
      return await buildCatalogDateManifest(
        `BookMyShow theatre-page date discovery failed for ${venueCode || "all theatres"}: ${error.message}`
      );
    } catch (catalogError) {
      if (venueCode) {
        return {
          version: 1,
          generatedAt: new Date().toISOString(),
          liveDiscovery: true,
          source: "bookmyshow-theatre-page",
          venueCode,
          dates: [],
          meta: {
            status: "error",
            notes: [
              `BookMyShow theatre-page date discovery failed for ${venueCode}: ${error.message}`,
              `Madanapalle event-catalog date discovery failed: ${catalogError.message}`
            ]
          }
        };
      }
    }

    // Fall through to the older event-code scan only for the expensive all-theatres overview.
  }

  const today = getIndiaTodayIso();
  const latestBaseline = await fetchBaselineSnapshot(fetchImpl, snapshotBaseUrl, "today").catch(
    () => null
  );
  const eventCodes = await fetchDateManifest(fetchImpl, snapshotBaseUrl)
    .then(eventCodesFromManifest)
    .catch(() =>
      latestBaseline?.shows?.length
        ? [...new Set(latestBaseline.shows.map((show) => show.eventCode).filter(Boolean))]
        : []
    );
  const dates = [];

  for (let offset = 0; offset < days; offset += 1) {
    const targetDate = addDaysIso(today, offset);
      const output = await discoverLiveShowsForDate({
        fetchImpl,
        snapshotBaseUrl,
      targetDate,
      venueCode,
      seedBaseline: latestBaseline,
      retryRounds: 1,
      eventCodes
    });

    if (output.shows.length) {
      dates.push(buildDateManifestEntry(output));
    }
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    liveDiscovery: true,
    venueCode,
    dates
  };
}

export function buildHealthPayload() {
  return {
    ok: true,
    service: "mpltracking-live-proxy"
  };
}
