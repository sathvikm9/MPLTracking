import React from "react";
import ReactDOM from "react-dom/client";

import "./styles.css";

const INDIA_TIMEZONE = "Asia/Kolkata";
const SERVER_ERROR_MESSAGE = "Server is not responding, please try again later.";
const LAST_GOOD_DASHBOARD_CACHE_PREFIX = "mpltracking:last-good-live";
const LAST_GOOD_DASHBOARD_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 6;
const CITY_INFO = {
  name: "Madanapalle",
  regionCode: "MDNP",
  timezone: INDIA_TIMEZONE,
  slug: "madanapalle",
  country: "India",
  state: "Andhra Pradesh"
};
const THEATRE_OPTIONS = [
  { value: "RTDM", label: "Ravi" },
  { value: "SKMD", label: "Sri Krishna" },
  { value: "MSDR", label: "Siddartha" },
  { value: "ASRM", label: "ASR" },
  { value: "ALL", label: "All Theatres" }
];
const THEATRE_BY_CODE = new Map(THEATRE_OPTIONS.map((option) => [option.value, option.label]));

function currency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(value || 0);
}

function number(value) {
  return new Intl.NumberFormat("en-IN").format(value || 0);
}

function percent(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function ticketLabel(value) {
  const count = Number(value || 0);
  return `${number(count)} ticket${count === 1 ? "" : "s"}`;
}

function netTicketPrice(price) {
  return Math.max(Number(price || 0) - 5, 0);
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === null || value === undefined || value === "") return 0;

  const parsed = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function showGross(show) {
  const categories = Array.isArray(show.categories) ? show.categories : [];
  if (!categories.length) return Number(show.gross || 0);

  return categories.reduce(
    (sum, category) => sum + Number(category.soldSeats || 0) * netTicketPrice(category.price),
    0
  );
}

function categoryBreakdown(show) {
  const categories = Array.isArray(show.categories) ? show.categories : [];
  const parts = categories
    .filter((category) => Number(category.totalSeats || 0) > 0 || Number(category.soldSeats || 0) > 0)
    .map((category) => {
      const price = Number(category.price || 0);
      return `${number(category.soldSeats)} x ₹${netTicketPrice(price)} (${price ? `₹${price} ticket` : category.label})`;
    });

  return parts.length ? parts.join(" + ") : "Seat-category split unavailable";
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const error = new Error(`Failed to load data: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

async function loadRuntimeConfig() {
  try {
    return await fetchJson(`./runtime-config.json?ts=${Date.now()}`);
  } catch {
    return {};
  }
}

function normalizeLiveApiBase(config) {
  const value = String(config?.liveApiBase || "").trim();
  return value ? value.replace(/\/$/, "") : "";
}

function annotateClientSource(data, source) {
  return {
    ...data,
    meta: {
      ...(data.meta || {}),
      clientSource: source
    }
  };
}

function buildSummaryFromShows(shows) {
  const totalShows = shows.length;
  const totalCapacity = shows.reduce((sum, show) => sum + Number(show.totalSeats || 0), 0);
  const totalAvailable = shows.reduce((sum, show) => sum + Number(show.availableSeats || 0), 0);
  const totalSold = shows.reduce((sum, show) => sum + Number(show.soldSeats || 0), 0);
  const totalGross = shows.reduce((sum, show) => sum + showGross(show), 0);

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

function summarizeMoviesFromShows(shows) {
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
    entry.totalCapacity += Number(show.totalSeats || 0);
    entry.totalAvailable += Number(show.availableSeats || 0);
    entry.totalSold += Number(show.soldSeats || 0);
    entry.totalGross += showGross(show);
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
    .sort((left, right) => right.totalSold - left.totalSold || left.title.localeCompare(right.title));
}

function summarizeTheatresFromShows(shows) {
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
    entry.totalCapacity += Number(show.totalSeats || 0);
    entry.totalAvailable += Number(show.availableSeats || 0);
    entry.totalSold += Number(show.soldSeats || 0);
    entry.totalGross += showGross(show);
  }

  return Array.from(map.values())
    .map((entry) => ({
      ...entry,
      occupancyPercent: entry.totalCapacity
        ? Number(((entry.totalSold / entry.totalCapacity) * 100).toFixed(2))
        : 0
    }))
    .sort((left, right) => right.totalSold - left.totalSold || left.shortName.localeCompare(right.shortName));
}

function buildEmptyDataset(targetDate, notes = []) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    targetDate,
    targetDateCode: targetDate.replaceAll("-", ""),
    timezone: CITY_INFO.timezone,
    city: CITY_INFO,
    summary: buildSummaryFromShows([]),
    movies: [],
    theatres: [],
    shows: [],
    meta: {
      status: "ok",
      notes
    }
  };
}

function isoToDateCode(date) {
  return String(date || "").replaceAll("-", "");
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
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: INDIA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function formatDateButtonParts(isoDate) {
  const date = new Date(`${isoDate}T00:00:00+05:30`);
  return {
    weekday: new Intl.DateTimeFormat("en-US", {
      timeZone: INDIA_TIMEZONE,
      weekday: "short"
    }).format(date),
    day: new Intl.DateTimeFormat("en-US", {
      timeZone: INDIA_TIMEZONE,
      day: "2-digit"
    }).format(date),
    month: new Intl.DateTimeFormat("en-US", {
      timeZone: INDIA_TIMEZONE,
      month: "short"
    }).format(date)
  };
}

function formatSelectedDateLabel(isoDate) {
  const date = new Date(`${isoDate}T00:00:00+05:30`);
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: INDIA_TIMEZONE,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

function isPastIndiaDate(isoDate) {
  return isoDate < getIndiaTodayIso();
}

function buildDateOption(entry) {
  const isoDate = entry.date || entry.value;
  return {
    value: isoDate,
    totalShows: Number(entry.totalShows || 0),
    availabilityOnly: Boolean(entry.availabilityOnly),
    theatres: entry.theatres || [],
    theatreCounts: entry.theatreCounts || {},
    movies: entry.movies || [],
    ...formatDateButtonParts(isoDate)
  };
}

function dateHasShowsForTheatre(entry, selectedTheatre) {
  if (isPastIndiaDate(entry.value)) return false;
  if (entry.availabilityOnly && selectedTheatre === "ALL") return true;
  if (entry.availabilityOnly && entry.theatreCounts?.[selectedTheatre]?.available) return true;
  if (selectedTheatre === "ALL") return Number(entry.totalShows || 0) > 0;
  return Number(entry.theatreCounts?.[selectedTheatre]?.totalShows || 0) > 0;
}

function showsForDateOption(option, selectedTheatre) {
  if (option.availabilityOnly) return null;
  if (selectedTheatre === "ALL") return Number(option.totalShows || 0);
  return Number(option.theatreCounts?.[selectedTheatre]?.totalShows || 0);
}

function dateShowLabel(option, selectedTheatre) {
  const showCount = showsForDateOption(option, selectedTheatre);
  return showCount === null ? "booking open" : `${number(showCount)} shows`;
}

function pickPreferredDate(dateOptions) {
  if (!dateOptions.length) return getIndiaTodayIso();

  const today = getIndiaTodayIso();
  return (
    dateOptions.find((option) => option.value >= today)?.value ||
    dateOptions[dateOptions.length - 1].value
  );
}

function isSupportedDate(isoDate, dateOptions) {
  return dateOptions.some((option) => option.value === isoDate);
}

function getInitialSelectedDate() {
  if (typeof window === "undefined") return getIndiaTodayIso();

  const urlDate = new URLSearchParams(window.location.search).get("date");
  if (/^\d{4}-\d{2}-\d{2}$/.test(urlDate || "")) {
    return urlDate;
  }

  return getIndiaTodayIso();
}

function getInitialSelectedTheatre() {
  if (typeof window === "undefined") return "ALL";

  const urlTheatre = new URLSearchParams(window.location.search).get("theatre");
  if (THEATRE_OPTIONS.some((option) => option.value === urlTheatre)) {
    return urlTheatre;
  }

  return "ALL";
}

function syncSelectionToUrl(selectedDate, selectedTheatre, movieTracking) {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  url.searchParams.set("date", selectedDate);

  if (selectedTheatre === "ALL") {
    url.searchParams.delete("theatre");
  } else {
    url.searchParams.set("theatre", selectedTheatre);
  }

  if (movieTracking?.eventCode) {
    url.searchParams.set("eventCode", movieTracking.eventCode);
    url.searchParams.set("moviename", movieTracking.movieName || "");
  } else {
    url.searchParams.delete("eventCode");
    url.searchParams.delete("moviename");
  }

  window.history.replaceState({}, "", `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
}

function formatGeneratedAt(data) {
  const raw = data?.generatedAt;
  if (!raw) return data?.generatedAtLabel || "Unknown";

  try {
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
      timeZone: data?.timezone || INDIA_TIMEZONE
    }).format(new Date(raw));
  } catch {
    return data?.generatedAtLabel || raw;
  }
}

function snapshotAgeLabel(raw) {
  if (!raw) return "Unknown age";

  const then = new Date(raw).getTime();
  const now = Date.now();

  if (!Number.isFinite(then)) return "Unknown age";

  const diffMinutes = Math.max(0, Math.round((now - then) / 60000));

  if (diffMinutes < 1) return "Updated just now";
  if (diffMinutes === 1) return "Updated 1 minute ago";
  if (diffMinutes < 60) return `Updated ${diffMinutes} minutes ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours === 1) return "Updated 1 hour ago";
  if (diffHours < 24) return `Updated ${diffHours} hours ago`;

  const diffDays = Math.round(diffHours / 24);
  return `Updated ${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

function movieLabelFromShow(show) {
  const base = String(show.releaseLabel || show.title || "Unknown Movie")
    .replace(/\s+/g, " ")
    .trim();
  const language = String(show.language || "").trim();

  if (!language) return base;
  if (base.toLowerCase().includes(language.toLowerCase())) return base;
  return `${base} ${language}`.trim();
}

function compareShows(left, right) {
  const leftTime = left.showDateTime || "";
  const rightTime = right.showDateTime || "";
  if (leftTime !== rightTime) {
    return leftTime.localeCompare(rightTime);
  }

  return String(left.theatreShortName || "").localeCompare(String(right.theatreShortName || ""));
}

function buildMovieWiseGroups(shows) {
  const map = new Map();

  for (const show of shows) {
    const movieLabel = movieLabelFromShow(show);
    const key = [show.releaseLabel || show.title, show.language || "", show.format || ""].join("::");

    if (!map.has(key)) {
      map.set(key, {
        key,
        movieLabel,
        totalSold: 0,
        totalShows: 0,
        shows: []
      });
    }

    const entry = map.get(key);
    entry.totalSold += Number(show.soldSeats || 0);
    entry.totalShows += 1;
    entry.shows.push(show);
  }

  return Array.from(map.values())
    .map((entry) => ({
      ...entry,
      shows: [...entry.shows].sort(compareShows)
    }))
    .sort(
      (left, right) =>
        right.totalSold - left.totalSold || left.movieLabel.localeCompare(right.movieLabel)
    );
}

function movieNameFromSearchParam(value) {
  try {
    return decodeURIComponent(String(value || "").replace(/\+/g, " ")).trim();
  } catch {
    return String(value || "").trim();
  }
}

function getInitialMovieTracking() {
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.search);
  const eventCode = params.get("eventCode");
  if (!/^ET\d+$/i.test(eventCode || "")) return null;

  const movieName = movieNameFromSearchParam(params.get("moviename")) || eventCode;

  return {
    eventCode: eventCode.toUpperCase(),
    movieName,
    date: params.get("date") || getIndiaTodayIso()
  };
}

function normalizeMovieShowtimePayload({ payload, meta, selectedDate, movieName }) {
  const shows = [];
  const showDetails = Array.isArray(payload?.ShowDetails) ? payload.ShowDetails : [];
  const targetDateCode = isoToDateCode(selectedDate);

  for (const showDetail of showDetails) {
    if (showDetail.Date && String(showDetail.Date) !== targetDateCode) continue;

    const childEvents = Array.isArray(showDetail?.Event?.ChildEvents)
      ? showDetail.Event.ChildEvents
      : [];
    const childEventsByCode = new Map(
      childEvents
        .filter((childEvent) => childEvent?.EventCode)
        .map((childEvent) => [childEvent.EventCode, childEvent])
    );

    for (const venue of showDetail.Venues || []) {
      const venueCode = venue.VenueCode;
      const venueName = venue.VenueName || venueCode;
      const shortName = THEATRE_BY_CODE.get(venueCode) || venueCode;

      for (const showTime of venue.ShowTimes || []) {
        const showDateCode = String(showTime.ShowDateCode || showDetail.Date || "");
        if (targetDateCode && showDateCode !== targetDateCode) continue;

        const childEvent =
          childEventsByCode.get(showTime.EventCode) || childEvents[0] || showDetail.Event || {};
        const categories = (showTime.Categories || []).map((category) => {
          const price = toNumber(category.CurPrice || category.Price || category.price);
          const totalSeats = toNumber(category.MaxSeats || category.totalSeats);
          const availableSeats = toNumber(category.SeatsAvail || category.availableSeats);
          const soldSeats = Math.max(totalSeats - availableSeats, 0);

          return {
            name: category.PriceDesc || category.name || "Category",
            label: category.PriceDesc || category.label || category.name || "Category",
            price,
            netPrice: netTicketPrice(price),
            totalSeats,
            availableSeats,
            soldSeats,
            unknownSeats: 0,
            rows: []
          };
        });

        const totalSeats = categories.reduce((sum, category) => sum + category.totalSeats, 0);
        const availableSeats = categories.reduce((sum, category) => sum + category.availableSeats, 0);
        const soldSeats = categories.reduce((sum, category) => sum + category.soldSeats, 0);
        const gross = categories.reduce(
          (sum, category) => sum + category.soldSeats * netTicketPrice(category.price),
          0
        );

        shows.push({
          id: `${venueCode}-${showTime.SessionId}`,
          eventCode: showTime.EventCode || childEvent.EventCode || meta?.eventCode,
          sessionId: showTime.SessionId,
          venueCode,
          venueName,
          theatreShortName: shortName,
          citySlug: CITY_INFO.slug,
          showDate: dateCodeToIso(showDateCode),
          showDateCode,
          showDateTime: showDateTimeToIso(showTime.ShowDateTime),
          showDateTimeCode: showTime.ShowDateTime,
          showTimeLabel: showTime.ShowTime,
          cutoffAt: showDateTimeToIso(showTime.CutOffDateTime),
          cutoffCode: showTime.CutOffDateTime || null,
          format: childEvent.EventDimension || "",
          language: childEvent.EventLang || "",
          title: childEvent.EventName || childEvent.EventTitle || movieName,
          releaseLabel: showDetail?.Event?.EventTitle || childEvent.EventTitle || movieName,
          censor: childEvent.EventCensor || "",
          genres: [],
          categories,
          totalSeats,
          availableSeats,
          soldSeats,
          unknownSeats: 0,
          gross,
          occupancyPercent: totalSeats ? Number(((soldSeats / totalSeats) * 100).toFixed(2)) : 0,
          source: {
            method: "movie-event-showtimes",
            capturedAt: new Date().toISOString()
          }
        });
      }
    }
  }

  return {
    version: 1,
    generatedAt: meta?.generatedAt || new Date().toISOString(),
    targetDate: selectedDate,
    targetDateCode,
    timezone: CITY_INFO.timezone,
    city: CITY_INFO,
    summary: buildSummaryFromShows(shows),
    movies: summarizeMoviesFromShows(shows),
    theatres: summarizeTheatresFromShows(shows),
    shows: shows.sort(compareShows),
    meta: {
      status: "ok",
      source: "movie-event-showtimes",
      movieTracking: true,
      eventCode: meta?.eventCode,
      upstream: meta?.upstream,
      summary: meta?.summary,
      cache: meta?.cache
    }
  };
}

function dashboardCacheKey(selectedDate, selectedTheatre) {
  return `${LAST_GOOD_DASHBOARD_CACHE_PREFIX}:${selectedDate}:${selectedTheatre}`;
}

function hasLiveSeatCounts(data) {
  return (data?.shows || []).some((show) =>
    ["bookmyshow-theatre-page", "live-proxy-showtimes", "live-proxy-discovery", "movie-event-showtimes"].includes(
      show.source?.method
    ) && Number(show.totalSeats || 0) > 0
  );
}

function isLiveCountFailure(data) {
  const liveRefresh = data?.meta?.liveRefresh || {};
  const shows = data?.shows || [];
  return (
    data?.meta?.status === "error" ||
    (
    Number(liveRefresh.failedEvents || 0) > 0 &&
      Number(liveRefresh.attemptedEvents || 0) > 0 &&
      Number(liveRefresh.failedEvents || 0) >= Number(liveRefresh.attemptedEvents || 0) &&
      Number(liveRefresh.liveShowCount || 0) === 0 &&
      !shows.some((show) => Number(show.totalSeats || 0) > 0)
    )
  );
}

function readLastGoodDashboard(selectedDate, selectedTheatre) {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(dashboardCacheKey(selectedDate, selectedTheatre));
    if (!raw) return null;

    const cached = JSON.parse(raw);
    const ageMs = Date.now() - Number(cached.cachedAtMs || 0);
    if (!cached.data || ageMs > LAST_GOOD_DASHBOARD_CACHE_MAX_AGE_MS) {
      window.localStorage.removeItem(dashboardCacheKey(selectedDate, selectedTheatre));
      return null;
    }

    return {
      ...cached.data,
      meta: {
        ...(cached.data.meta || {}),
        cacheFallback: {
          hit: true,
          cachedAt: cached.cachedAt,
          ageMs
        },
        notes: [
          `Using last successful live data from ${formatGeneratedAt(cached.data)} because the current mirror refresh failed.`,
          ...((cached.data.meta && cached.data.meta.notes) || [])
        ]
      }
    };
  } catch {
    return null;
  }
}

function writeLastGoodDashboard(selectedDate, selectedTheatre, data) {
  if (typeof window === "undefined" || !hasLiveSeatCounts(data)) return;

  try {
    window.localStorage.setItem(
      dashboardCacheKey(selectedDate, selectedTheatre),
      JSON.stringify({
        cachedAt: new Date().toISOString(),
        cachedAtMs: Date.now(),
        data
      })
    );
  } catch {
    // Cache is best-effort; live rendering should never fail because storage is unavailable.
  }
}

function useDateAvailability(selectedTheatre) {
  const [state, setState] = React.useState({
    loading: true,
    error: null,
    notes: [],
    dateOptions: [],
    allDates: []
  });

  React.useEffect(() => {
    let active = true;

    loadRuntimeConfig()
      .then(async (config) => {
        const liveApiBase = normalizeLiveApiBase(config);
        if (!liveApiBase) {
          return fetchJson(`./data/dates.json?ts=${Date.now()}`);
        }

        try {
          const liveDatesUrl = new URL(`${liveApiBase}/api/live-dates`);
          liveDatesUrl.searchParams.set("days", "9");
          liveDatesUrl.searchParams.set("ts", String(Date.now()));

          if (selectedTheatre !== "ALL") {
            liveDatesUrl.searchParams.set("venueCode", selectedTheatre);
          }

          return await fetchJson(liveDatesUrl.toString());
        } catch {
          return fetchJson(`./data/dates.json?ts=${Date.now()}`);
        }
      })
      .then((manifest) => {
        if (!active) return;

        const allDates = (manifest.dates || []).map(buildDateOption);
        const dateOptions = allDates.filter((entry) =>
          dateHasShowsForTheatre(entry, selectedTheatre)
        );

        setState({
          loading: false,
          error: null,
          notes: manifest.meta?.notes || [],
          dateOptions,
          allDates
        });
      })
      .catch((error) => {
        if (!active) return;

        setState({
          loading: false,
          error,
          notes: [],
          dateOptions: [],
          allDates: []
        });
      });

    return () => {
      active = false;
    };
  }, [selectedTheatre]);

  return state;
}

function useDashboardData(selectedDate, selectedTheatre) {
  const [state, setState] = React.useState({
    loading: true,
    error: null,
    data: null,
    refreshing: false
  });

  const loadDashboard = React.useCallback(async () => {
    const config = await loadRuntimeConfig();
    const liveApiBase = normalizeLiveApiBase(config);
    if (!liveApiBase) {
      throw new Error(SERVER_ERROR_MESSAGE);
    }

    const liveUrl = new URL(`${liveApiBase}/api/live`);
    liveUrl.searchParams.set("date", selectedDate);
    liveUrl.searchParams.set("strict", "1");
    liveUrl.searchParams.set("ts", String(Date.now()));

    if (selectedTheatre !== "ALL") {
      liveUrl.searchParams.set("venueCode", selectedTheatre);
    }

    const liveData = await fetchJson(liveUrl.toString());
    if (liveData.targetDate !== selectedDate) {
      throw new Error(SERVER_ERROR_MESSAGE);
    }

    if (isLiveCountFailure(liveData)) {
      throw new Error(SERVER_ERROR_MESSAGE);
    }

    return {
      ok: true,
      data: annotateClientSource(liveData, {
        mode: "live-proxy",
        liveApiBase,
        selectedDate,
        selectedTheatre
      })
    };
  }, [selectedDate, selectedTheatre]);

  const loadData = React.useCallback(
    (mode = "initial") => {
      const isInitial = mode === "initial";

      setState((current) => ({
        ...current,
        loading: isInitial ? true : current.loading,
        refreshing: !isInitial,
        error: null
      }));

      return loadDashboard().catch((error) => ({ ok: false, error }));
    },
    [loadDashboard]
  );

  React.useEffect(() => {
    let active = true;

    loadData("initial").then((result) => {
      if (!active) return;

      if (result.ok) {
        setState({
          loading: false,
          refreshing: false,
          error: null,
          data: result.data
        });
        return;
      }

      setState({
        loading: false,
        refreshing: false,
        error: result.error,
        data: null
      });
    });

    return () => {
      active = false;
    };
  }, [loadData]);

  const refresh = React.useCallback(() => {
    loadData("refresh").then((result) => {
      setState((current) => {
        if (result.ok) {
          return {
            loading: false,
            refreshing: false,
            error: null,
            data: result.data
          };
        }

        return {
          loading: false,
          refreshing: false,
          error: result.error,
          data: null
        };
      });
    });
  }, [loadData]);

  return { ...state, refresh };
}

function StatCard({ eyebrow, value, caption, tone = "default" }) {
  return (
    <article className={`stat-card stat-card--${tone}`}>
      <p className="stat-card__eyebrow">{eyebrow}</p>
      <p className="stat-card__value">{value}</p>
      <p className="stat-card__caption">{caption}</p>
    </article>
  );
}

function Section({ title, kicker, children, aside = null }) {
  return (
    <section className="section">
      <header className="section__header">
        <div>
          {kicker ? <p className="section__kicker">{kicker}</p> : null}
          <h2>{title}</h2>
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

function Table({ columns, rows, emptyMessage }) {
  if (!rows.length) {
    return <div className="empty-state">{emptyMessage}</div>;
  }

  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id || row.key}>
              {columns.map((column) => (
                <td key={column.key}>{column.render ? column.render(row) : row[column.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Notes({ notes }) {
  if (!notes?.length) return null;

  return (
    <section className="notes-panel">
      <p className="notes-panel__title">Collector Notes</p>
      <ul className="notes-panel__list">
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </section>
  );
}

function MovieWiseBoard({ shows, emptyMessage }) {
  const groups = buildMovieWiseGroups(shows);

  if (!groups.length) {
    return <div className="empty-state">{emptyMessage}</div>;
  }

  return (
    <div className="movie-cluster-grid">
      {groups.map((group) => (
        <article className="movie-cluster" key={group.key}>
          <header className="movie-cluster__header">
            <div>
              <p className="movie-cluster__eyebrow">Movie</p>
              <h3>{group.movieLabel}</h3>
            </div>
            <div className="movie-cluster__badge">{ticketLabel(group.totalSold)}</div>
          </header>

          <div className="movie-line-list">
            {group.shows.map((show) => (
              <div className="movie-line" key={show.id}>
                <p className="movie-line__sentence">
                  <strong>{show.theatreShortName}</strong> {show.showTimeLabel}{" "}
                  {movieLabelFromShow(show)} {ticketLabel(show.soldSeats)}
                </p>
                <p className="movie-line__meta">
                  {number(show.availableSeats)} available · {number(show.totalSeats)} total ·{" "}
                  {currency(showGross(show))} gross
                </p>
                <p className="movie-line__meta">{categoryBreakdown(show)}</p>
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function ShowCards({ shows, emptyMessage }) {
  if (!shows.length) {
    return <div className="empty-state">{emptyMessage}</div>;
  }

  return (
    <div className="show-card-grid">
      {shows.map((show) => (
        <article className="show-card" key={show.id}>
          <div>
            <p className="show-card__time">{show.showTimeLabel}</p>
            <h3>{movieLabelFromShow(show)}</h3>
            <p>{show.theatreShortName}</p>
          </div>
          <div className="show-card__numbers">
            <strong>{ticketLabel(show.soldSeats)}</strong>
            <span>{currency(showGross(show))}</span>
          </div>
          <p className="show-card__meta">{categoryBreakdown(show)}</p>
          <p className="show-card__meta">
            {number(show.availableSeats)} available · {percent(show.occupancyPercent)} occupancy
          </p>
        </article>
      ))}
    </div>
  );
}

function App() {
  const [selectedDate, setSelectedDate] = React.useState(getInitialSelectedDate);
  const [selectedTheatre, setSelectedTheatre] = React.useState(getInitialSelectedTheatre);
  const { loading, error, data, refreshing, refresh } = useDashboardData(selectedDate, selectedTheatre);

  React.useEffect(() => {
    syncSelectionToUrl(selectedDate, selectedTheatre, null);
  }, [selectedDate, selectedTheatre]);

  const selectedTheatreLabel =
    THEATRE_OPTIONS.find((option) => option.value === selectedTheatre)?.label || "All Theatres";
  const safeData = error || !data ? buildEmptyDataset(selectedDate) : data;
  const allShows = [...(safeData.shows || [])].sort(compareShows);
  const filteredShows =
    selectedTheatre === "ALL"
      ? allShows
      : allShows.filter((show) => show.venueCode === selectedTheatre);
  const summary = buildSummaryFromShows(filteredShows);
  const movies = summarizeMoviesFromShows(filteredShows);
  const theatres = summarizeTheatresFromShows(filteredShows);
  const generatedLabel = data ? formatGeneratedAt(data) : "Not loaded yet";
  const ageLabel = data ? snapshotAgeLabel(data.generatedAt) : "Waiting for live API";
  const isBusy = loading || refreshing;
  const statusMessage = loading
    ? `Fetching live data for ${selectedTheatreLabel} on ${formatSelectedDateLabel(selectedDate)}...`
    : refreshing
      ? "Refreshing live data..."
      : error
        ? SERVER_ERROR_MESSAGE
        : !filteredShows.length
          ? "No Shows Available for selected date"
          : `${number(filteredShows.length)} live show lines loaded.`;
  const emptyMessage = error
    ? SERVER_ERROR_MESSAGE
    : isBusy
      ? "Fetching live data..."
      : "No Shows Available for selected date";

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="hero__content">
          <p className="hero__eyebrow">Madanapalle Live Tracker</p>
          <h1>Pick a theatre. Pick a date. Get live tickets.</h1>
          <p className="hero__lede">
            This page checks only the selected theatre and date. If BookMyShow has visible shows, it
            displays movie names, show timings, booked tickets, occupancy, and net gross using
            ₹105→₹100 and ₹84→₹79.
          </p>

          <div className="selector-shell">
            <label className="selector-select-shell">
              <span className="selector-select__label">1. Select theatre</span>
              <select
                className="selector-select"
                value={selectedTheatre}
                onChange={(event) => setSelectedTheatre(event.target.value)}
              >
                {THEATRE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="selector-select-shell selector-select-shell--date">
              <span className="selector-select__label">2. Select date</span>
              <input
                className="date-input"
                type="date"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value || getIndiaTodayIso())}
              />
            </label>
          </div>

          <div
            className={`status-panel${
              error ? " status-panel--error" : isBusy ? " status-panel--loading" : ""
            }`}
          >
            {isBusy ? <span className="status-spinner" aria-hidden="true" /> : null}
            <span>{statusMessage}</span>
          </div>

          <div className="hero__actions">
            <button className="refresh-button" onClick={refresh} disabled={isBusy}>
              {isBusy ? <span className="button-spinner" aria-hidden="true" /> : null}
              {refreshing ? "Refreshing live data..." : "Refresh live data"}
            </button>
            <p className="hero__note">
              Every selection and refresh calls the live API again. If the server or BookMyShow mirror
              fails, this page shows a server error instead of old data.
            </p>
          </div>
        </div>

        <div className="hero__meta">
          <div className="meta-pill">
            <span>Selected Date</span>
            <strong>{formatSelectedDateLabel(selectedDate)}</strong>
          </div>
          <div className="meta-pill">
            <span>Theatre Filter</span>
            <strong>{selectedTheatreLabel}</strong>
            <small>{selectedTheatre === "ALL" ? "All active Madanapalle theatres" : "Single theatre"}</small>
          </div>
          <div className="meta-pill">
            <span>Last Checked</span>
            <strong>{generatedLabel}</strong>
            <small>{ageLabel}</small>
          </div>
          <div className="meta-pill">
            <span>Live Shows</span>
            <strong>{number(filteredShows.length)}</strong>
            <small>{movies.length ? `${number(movies.length)} movies` : "No movie rows yet"}</small>
          </div>
        </div>
      </section>

      <section className="stats-grid">
        <StatCard
          eyebrow="Total Sold"
          value={number(summary.totalSold)}
          caption={`${number(summary.totalCapacity)} total seats tracked`}
          tone="warm"
        />
        <StatCard
          eyebrow="Occupancy"
          value={percent(summary.occupancyPercent)}
          caption={`${number(summary.totalAvailable)} seats still available`}
          tone="amber"
        />
          <StatCard
          eyebrow="Gross"
          value={currency(summary.totalGross)}
          caption={`${number(summary.totalShows)} live shows using ₹105→₹100 and ₹84→₹79`}
          tone="ink"
        />
        <StatCard
          eyebrow="Coverage"
          value={`${selectedTheatre === "ALL" ? theatres.length : filteredShows.length ? 1 : 0} theatres`}
          caption={`${movies.length} movies tracked in this selection`}
        />
      </section>

      <Section
        title="Live Shows"
        kicker="Selected theatre/date result"
        aside={<span className="section__hint">{filteredShows.length} show lines</span>}
      >
        <ShowCards shows={filteredShows} emptyMessage={emptyMessage} />
      </Section>

      <Section
        title="Movie-wise Lines"
        kicker="Theatre, time, movie, tickets format"
        aside={<span className="section__hint">{filteredShows.length} show lines</span>}
      >
        <MovieWiseBoard shows={filteredShows} emptyMessage={emptyMessage} />
      </Section>

      <Section
        title="Movie Pulse"
        kicker="Ranked by sold seats"
        aside={<span className="section__hint">{movies.length} movies</span>}
      >
        <Table
          columns={[
            {
              key: "title",
              label: "Movie",
              render: (movie) => (
                <div>
                  <strong>{movie.title}</strong>
                  <div className="table-subline">
                    {movie.language || "Unknown"} · {movie.format || "Unknown"} · {movie.venueCount} venues
                  </div>
                </div>
              )
            },
            {
              key: "totalSold",
              label: "Sold",
              render: (movie) => number(movie.totalSold)
            },
            {
              key: "totalCapacity",
              label: "Capacity",
              render: (movie) => number(movie.totalCapacity)
            },
            {
              key: "occupancyPercent",
              label: "Occupancy",
              render: (movie) => percent(movie.occupancyPercent)
            },
            {
              key: "totalGross",
              label: "Gross",
              render: (movie) => currency(movie.totalGross)
            }
          ]}
          rows={movies.map((movie) => ({
            ...movie,
            id: movie.eventCode
          }))}
          emptyMessage={emptyMessage}
        />
      </Section>

      <Section
        title="Theatre Watch"
        kicker="Venue-wise totals"
        aside={<span className="section__hint">{theatres.length} theatres</span>}
      >
        <Table
          columns={[
            {
              key: "name",
              label: "Theatre",
              render: (theatre) => (
                <div>
                  <strong>{theatre.shortName}</strong>
                  <div className="table-subline">{theatre.name}</div>
                </div>
              )
            },
            {
              key: "totalShows",
              label: "Shows",
              render: (theatre) => number(theatre.totalShows)
            },
            {
              key: "totalSold",
              label: "Sold",
              render: (theatre) => number(theatre.totalSold)
            },
            {
              key: "occupancyPercent",
              label: "Occupancy",
              render: (theatre) => percent(theatre.occupancyPercent)
            },
            {
              key: "totalGross",
              label: "Gross",
              render: (theatre) => currency(theatre.totalGross)
            }
          ]}
          rows={theatres.map((theatre) => ({
            ...theatre,
            id: theatre.venueCode
          }))}
          emptyMessage={emptyMessage}
        />
      </Section>

      <Section
        title="Show Ledger"
        kicker="Every show captured in the latest run"
        aside={<span className="section__hint">{filteredShows.length} show snapshots</span>}
      >
        <Table
          columns={[
            {
              key: "theatreShortName",
              label: "Theatre",
              render: (show) => (
                <div>
                  <strong>{show.theatreShortName}</strong>
                  <div className="table-subline">{movieLabelFromShow(show)}</div>
                </div>
              )
            },
            {
              key: "showTimeLabel",
              label: "Time"
            },
            {
              key: "movie",
              label: "Movie",
              render: (show) => movieLabelFromShow(show)
            },
            {
              key: "soldSeats",
              label: "Tickets",
              render: (show) => ticketLabel(show.soldSeats)
            },
            {
              key: "availableSeats",
              label: "Available",
              render: (show) => number(show.availableSeats)
            },
            {
              key: "totalSeats",
              label: "Capacity",
              render: (show) => number(show.totalSeats)
            },
            {
              key: "occupancyPercent",
              label: "Occupancy",
              render: (show) => percent(show.occupancyPercent)
            },
            {
              key: "gross",
              label: "Gross",
              render: (show) => currency(showGross(show))
            }
          ]}
          rows={filteredShows}
          emptyMessage={emptyMessage}
        />
      </Section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
