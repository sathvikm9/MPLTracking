const SHOWTIME_API_BASE_URLS = [
  "https://bms-india.vercel.app/api/showtimes",
  "https://bms-india2.vercel.app/api/showtimes",
  "https://bms-india3.vercel.app/api/showtimes"
];

const SHOWTIME_API_HEADERS = {
  accept: "application/json, text/plain, */*",
  origin: "https://boxoffice24.pages.dev",
  referer: "https://boxoffice24.pages.dev/",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
};

const DEFAULT_SNAPSHOT_BASE_URL = "https://sathvikm9.github.io/MPLTracking/data";

function withCors(headers = {}) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    ...headers
  };
}

function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: withCors({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {})
    })
  });
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === null || value === undefined || value === "") return 0;

  const cleaned = String(value).replace(/[^\d.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
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

function buildSnapshotFromCategories(show, categories, method) {
  const totalSeats = categories.reduce((sum, category) => sum + category.totalSeats, 0);
  const availableSeats = categories.reduce((sum, category) => sum + category.availableSeats, 0);
  const soldSeats = categories.reduce((sum, category) => sum + category.soldSeats, 0);
  const unknownSeats = categories.reduce((sum, category) => sum + category.unknownSeats, 0);
  const gross = categories.reduce((sum, category) => sum + category.soldSeats * category.price, 0);

  return {
    ...show,
    categories,
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

async function fetchShowtimeApiPayload(eventCode, regionCode, dateCode, fetchImpl) {
  let lastError = null;

  for (const baseUrl of SHOWTIME_API_BASE_URLS) {
    try {
      const url = new URL(baseUrl);
      url.searchParams.set("eventCode", eventCode);
      url.searchParams.set("regionCode", regionCode);
      url.searchParams.set("dateCode", dateCode);

      const response = await fetchImpl(url, {
        headers: SHOWTIME_API_HEADERS
      });
      const payload = await response.text();

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}: ${payload.slice(0, 200)}`);
      }

      const parsed = JSON.parse(payload);
      if (!Array.isArray(parsed?.ShowDetails)) {
        throw new Error("Missing ShowDetails in showtime payload");
      }

      return parsed;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(`Unable to fetch showtime payload for ${eventCode}`);
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

function buildApiSnapshotsFromPayload(payload, theatreMap, baseShowIndex) {
  const snapshots = [];
  const showDetails = Array.isArray(payload?.ShowDetails) ? payload.ShowDetails : [];

  for (const showDetail of showDetails) {
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
    throw new Error(`Failed to load baseline snapshot: ${response.status}`);
  }

  return response.json();
}

async function refreshLiveSnapshot(baseline, fetchImpl) {
  const notes = [];
  const baseShows = Array.isArray(baseline?.shows) ? baseline.shows : [];
  const baseShowIndex = buildShowIndex(baseShows);
  const theatreMap = buildTheatreMap(baseShows, baseline?.theatres || []);
  const snapshotsById = new Map();

  for (const show of baseShows) {
    snapshotsById.set(show.id, show);
  }

  const uniqueEventCodes = [...new Set(baseShows.map((show) => show.eventCode).filter(Boolean))];
  for (const eventCode of uniqueEventCodes) {
    try {
      const payload = await fetchShowtimeApiPayload(
        eventCode,
        baseline.city.regionCode,
        baseline.targetDateCode,
        fetchImpl
      );

      for (const snapshot of buildApiSnapshotsFromPayload(payload, theatreMap, baseShowIndex)) {
        snapshotsById.set(snapshot.id, snapshot);
      }
    } catch (error) {
      notes.push(`Live refresh failed for ${eventCode}: ${error.message}`);
    }
  }

  return buildOutputFromBaseline(baseline, Array.from(snapshotsById.values()), notes);
}

async function handleLiveRequest(request, env) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const baseline = await fetchBaselineSnapshot(
    fetch,
    env.SNAPSHOT_BASE_URL || DEFAULT_SNAPSHOT_BASE_URL,
    date
  );
  const refreshed = await refreshLiveSnapshot(baseline, fetch);
  return jsonResponse(refreshed);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: withCors()
      });
    }

    if (url.pathname === "/health") {
      return jsonResponse({
        ok: true,
        service: "mpltracking-live-proxy"
      });
    }

    if (url.pathname === "/api/live") {
      try {
        return await handleLiveRequest(request, env);
      } catch (error) {
        return jsonResponse(
          {
            ok: false,
            error: error.message
          },
          {
            status: 500
          }
        );
      }
    }

    return jsonResponse(
      {
        ok: false,
        error: "Not found"
      },
      {
        status: 404
      }
    );
  }
};
