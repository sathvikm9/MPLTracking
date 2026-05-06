import { fetchMadanapalleShowtimesPayload } from "./madanapalle-showtimes.mjs";

export const DEFAULT_SNAPSHOT_BASE_URL = "https://sathvikm9.github.io/MPLTracking/data";

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

      for (const snapshot of buildApiSnapshotsFromPayload(payload, theatreMap, baseShowIndex)) {
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
  const date = url.searchParams.get("date");
  const venueCode = url.searchParams.get("venueCode");
  let baseline;

  try {
    baseline = await fetchBaselineSnapshot(fetchImpl, snapshotBaseUrl, date);
  } catch (error) {
    if (error.status !== 404 || !date || date === "today") {
      throw error;
    }

    const latestBaseline = await fetchBaselineSnapshot(fetchImpl, snapshotBaseUrl, "today");
    return filterOutputByVenueCode(
      buildEmptyOutputFromBaseline(latestBaseline, date, [
        `No published baseline was found for ${date}.`,
        "No shows were found for the selected date."
      ]),
      venueCode
    );
  }

  const scopedBaseline = filterBaselineByVenueCode(baseline, venueCode);
  return filterOutputByVenueCode(await refreshLiveSnapshot(scopedBaseline, fetchImpl), venueCode);
}

export function buildHealthPayload() {
  return {
    ok: true,
    service: "mpltracking-live-proxy"
  };
}
