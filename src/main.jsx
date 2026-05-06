import React from "react";
import ReactDOM from "react-dom/client";

import "./styles.css";

const INDIA_TIMEZONE = "Asia/Kolkata";
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
  { value: "ALL", label: "All Theatres" },
  { value: "ASRM", label: "ASR" },
  { value: "RTDM", label: "Ravi" },
  { value: "MSDR", label: "Siddartha" },
  { value: "SKMD", label: "Sri Krishna" }
];

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

function showGross(show) {
  const categories = Array.isArray(show.categories) ? show.categories : [];
  if (!categories.length) return Number(show.gross || 0);

  return categories.reduce(
    (sum, category) => sum + Number(category.soldSeats || 0) * netTicketPrice(category.price),
    0
  );
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
    theatres: entry.theatres || [],
    theatreCounts: entry.theatreCounts || {},
    movies: entry.movies || [],
    ...formatDateButtonParts(isoDate)
  };
}

function dateHasShowsForTheatre(entry, selectedTheatre) {
  if (isPastIndiaDate(entry.value)) return false;
  if (selectedTheatre === "ALL") return Number(entry.totalShows || 0) > 0;
  return Number(entry.theatreCounts?.[selectedTheatre]?.totalShows || 0) > 0;
}

function showsForDateOption(option, selectedTheatre) {
  if (selectedTheatre === "ALL") return Number(option.totalShows || 0);
  return Number(option.theatreCounts?.[selectedTheatre]?.totalShows || 0);
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(urlDate || "") && !isPastIndiaDate(urlDate)) {
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

function syncSelectionToUrl(selectedDate, selectedTheatre) {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  url.searchParams.set("date", selectedDate);

  if (selectedTheatre === "ALL") {
    url.searchParams.delete("theatre");
  } else {
    url.searchParams.set("theatre", selectedTheatre);
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

function dashboardCacheKey(selectedDate, selectedTheatre) {
  return `${LAST_GOOD_DASHBOARD_CACHE_PREFIX}:${selectedDate}:${selectedTheatre}`;
}

function hasLiveSeatCounts(data) {
  return (data?.shows || []).some((show) => show.source?.method === "live-proxy-showtimes");
}

function isLiveCountFailure(data) {
  const liveRefresh = data?.meta?.liveRefresh || {};
  const shows = data?.shows || [];
  return (
    shows.length > 0 &&
    Number(liveRefresh.failedEvents || 0) > 0 &&
    Number(liveRefresh.liveShowCount || 0) === 0
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
    dateOptions: [],
    allDates: []
  });

  React.useEffect(() => {
    let active = true;

    fetchJson(`./data/dates.json?ts=${Date.now()}`)
      .then((manifest) => {
        if (!active) return;

        const allDates = (manifest.dates || []).map(buildDateOption);
        const dateOptions = allDates.filter((entry) =>
          dateHasShowsForTheatre(entry, selectedTheatre)
        );

        setState({
          loading: false,
          error: null,
          dateOptions,
          allDates
        });
      })
      .catch((error) => {
        if (!active) return;

        setState({
          loading: false,
          error,
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
    const indiaToday = getIndiaTodayIso();
    const proxyDateParam = selectedDate;
    const staticPath =
      selectedDate === indiaToday
        ? `./data/latest.json?ts=${Date.now()}`
        : `./data/history/${selectedDate}.json?ts=${Date.now()}`;

    if (liveApiBase) {
      try {
        const liveUrl = new URL(`${liveApiBase}/api/live`);
        liveUrl.searchParams.set("date", proxyDateParam);
        liveUrl.searchParams.set("ts", String(Date.now()));

        if (selectedTheatre !== "ALL") {
          liveUrl.searchParams.set("venueCode", selectedTheatre);
        }

        const liveData = await fetchJson(liveUrl.toString());
        if (liveData.targetDate !== selectedDate) {
          throw new Error(
            `Live proxy returned ${liveData.targetDate || "unknown date"} for ${selectedDate}`
          );
        }

        if (hasLiveSeatCounts(liveData)) {
          writeLastGoodDashboard(selectedDate, selectedTheatre, liveData);
        } else if (isLiveCountFailure(liveData)) {
          const cachedLiveData = readLastGoodDashboard(selectedDate, selectedTheatre);
          if (cachedLiveData) {
            return {
              ok: true,
              data: annotateClientSource(cachedLiveData, {
                mode: "live-proxy",
                liveApiBase,
                selectedDate,
                selectedTheatre,
                fallbackReason: "Current mirror refresh failed; using browser last-good live data."
              })
            };
          }
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
      } catch (error) {
        try {
          const snapshot = await fetchJson(staticPath);
          const fallback = annotateClientSource(snapshot, {
            mode: "published-snapshot",
            liveApiBase,
            selectedDate,
            selectedTheatre,
            fallbackReason: error.message
          });

          return {
            ok: true,
            data: {
              ...fallback,
              meta: {
                ...(fallback.meta || {}),
                notes: [
                  `Live proxy fallback: ${error.message}`,
                  ...((fallback.meta && fallback.meta.notes) || [])
                ]
              }
            }
          };
        } catch (snapshotError) {
          return {
            ok: true,
            data: annotateClientSource(
              buildEmptyDataset(selectedDate, [
                `No shows were found for ${selectedDate}.`,
                "The selected date does not have a published snapshot yet."
              ]),
              {
                mode: "live-proxy",
                liveApiBase,
                selectedDate,
                selectedTheatre,
                fallbackReason: error.message
              }
            )
          };
        }
      }
    }

    try {
      const snapshot = await fetchJson(staticPath);
      return {
        ok: true,
        data: annotateClientSource(snapshot, {
          mode: "published-snapshot",
          liveApiBase: "",
          selectedDate,
          selectedTheatre
        })
      };
    } catch (error) {
      if (error.status === 404) {
        return {
          ok: true,
          data: annotateClientSource(
            buildEmptyDataset(selectedDate, [
              `No shows were found for ${selectedDate}.`,
              "The selected date does not have a published snapshot yet."
            ]),
            {
            mode: "published-snapshot",
            liveApiBase: "",
            selectedDate,
            selectedTheatre
          }
        )
        };
      }

      throw error;
    }
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
          ...current,
          loading: false,
          refreshing: false,
          error: result.error
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
                  {number(show.availableSeats)} available · {number(show.totalSeats)} total
                </p>
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function App() {
  const [selectedDate, setSelectedDate] = React.useState(getInitialSelectedDate);
  const [selectedTheatre, setSelectedTheatre] = React.useState(getInitialSelectedTheatre);
  const {
    loading: datesLoading,
    error: datesError,
    dateOptions
  } = useDateAvailability(selectedTheatre);
  const { loading, error, data, refreshing, refresh } = useDashboardData(
    selectedDate,
    selectedTheatre
  );

  React.useEffect(() => {
    if (datesLoading || !dateOptions.length) return;
    if (isSupportedDate(selectedDate, dateOptions)) return;

    setSelectedDate(pickPreferredDate(dateOptions));
  }, [dateOptions, datesLoading, selectedDate]);

  React.useEffect(() => {
    syncSelectionToUrl(selectedDate, selectedTheatre);
  }, [selectedDate, selectedTheatre]);

  if (loading) {
    return (
      <main className="app-shell">
        <div className="hero">
          <p className="hero__eyebrow">Madanapalle Live Tracker</p>
          <h1>Loading the latest snapshot.</h1>
        </div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="app-shell">
        <div className="hero">
          <p className="hero__eyebrow">Madanapalle Live Tracker</p>
          <h1>Dashboard unavailable.</h1>
          <p className="hero__lede">
            {error?.message || "No data was found. Run the collector first."}
          </p>
        </div>
      </main>
    );
  }

  const allShows = [...(data.shows || [])].sort(compareShows);
  const filteredShows =
    selectedTheatre === "ALL"
      ? allShows
      : allShows.filter((show) => show.venueCode === selectedTheatre);
  const summary = buildSummaryFromShows(filteredShows);
  const movies = summarizeMoviesFromShows(filteredShows);
  const theatres = summarizeTheatresFromShows(filteredShows);
  const generatedLabel = formatGeneratedAt(data);
  const ageLabel = snapshotAgeLabel(data.generatedAt);
  const clientSource = data.meta?.clientSource || {};
  const isLiveProxy = clientSource.mode === "live-proxy";
  const refreshButtonLabel = refreshing
    ? "Refreshing..."
    : isLiveProxy
      ? "Refresh live data"
      : "Check for newer snapshot";
  const sourceNote = isLiveProxy
    ? "Each date selection, theatre selection, and refresh asks the live proxy for current BookMyShow seat counts."
    : "Browser refresh only reloads the latest published JSON. On GitHub Pages, new numbers appear after the collector runs and a fresh deploy is published.";
  const selectedTheatreLabel =
    THEATRE_OPTIONS.find((option) => option.value === selectedTheatre)?.label || "All Theatres";
  const availableDateCount = dateOptions.length;
  const hasDiscoveryOnlyShows =
    filteredShows.length > 0 &&
    filteredShows.every((show) => show.source?.method === "bookmyshow-showtime-discovery");
  const liveRefresh = data.meta?.liveRefresh;
  const liveRetryFailed =
    isLiveProxy && hasDiscoveryOnlyShows && Number(liveRefresh?.failedEvents || 0) > 0;
  const discoveryOnlyMessage = liveRetryFailed
    ? "Live BookMyShow count retry failed for this selection, so showtimes are being shown without seat counts. Click Refresh live data to try the live mirrors again."
    : isPastIndiaDate(selectedDate)
      ? "This is now a past BookMyShow India date, so live seat counts are no longer exposed. The page is showing the saved snapshot/showtimes for that date."
      : "Showtimes are available for this date, but BookMyShow has not exposed live seat counts through the category payload yet.";
  const emptyMessage =
    selectedTheatre === "ALL"
      ? `No shows found for ${formatSelectedDateLabel(selectedDate)}.`
      : `No shows found for ${selectedTheatreLabel} on ${formatSelectedDateLabel(selectedDate)}.`;

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="hero__content">
          <p className="hero__eyebrow">Madanapalle Live Tracker</p>
          <h1>City-wide BookMyShow tracking built for Madanapalle.</h1>
          <p className="hero__lede">
            Dates are now generated from actual Madanapalle booking snapshots. Pick a theatre to
            see only the dates where that theatre has BookMyShow shows, then refresh for live
            booked-ticket counts.
          </p>

          <div className="selector-shell">
            <label className="selector-select-shell">
              <span className="selector-select__label">Theatre</span>
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

            <div className="date-selector-block">
              <p className="selector-select__label">Available booking dates</p>
              <div className="date-strip" aria-label="Date selection">
                {datesLoading ? <div className="date-strip__empty">Loading booking dates...</div> : null}
                {!datesLoading && datesError ? (
                  <div className="date-strip__empty">Could not load booking dates.</div>
                ) : null}
                {!datesLoading && !datesError && !dateOptions.length ? (
                  <div className="date-strip__empty">
                    No booking dates found for {selectedTheatreLabel}.
                  </div>
                ) : null}
                {!datesLoading && !datesError
                  ? dateOptions.map((option) => (
                      <button
                        key={option.value}
                        className={`date-chip${selectedDate === option.value ? " date-chip--active" : ""}`}
                        onClick={() => setSelectedDate(option.value)}
                        type="button"
                      >
                        <span className="date-chip__weekday">{option.weekday}</span>
                        <strong className="date-chip__day">{option.day}</strong>
                        <span className="date-chip__month">{option.month}</span>
                        <span className="date-chip__shows">
                          {number(showsForDateOption(option, selectedTheatre))} shows
                        </span>
                      </button>
                    ))
                  : null}
              </div>
            </div>
          </div>

          {hasDiscoveryOnlyShows ? (
            <div className="live-status-note">{discoveryOnlyMessage}</div>
          ) : null}

          <div className="hero__actions">
            <button className="refresh-button" onClick={refresh} disabled={refreshing}>
              {refreshButtonLabel}
            </button>
            <p className="hero__note">{sourceNote}</p>
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
            <small>{number(availableDateCount)} booking dates</small>
          </div>
          <div className="meta-pill">
            <span>Snapshot Generated</span>
            <strong>{generatedLabel}</strong>
            <small>{ageLabel}</small>
          </div>
          <div className="meta-pill">
            <span>Source Mode</span>
            <strong>{isLiveProxy ? "Live Proxy" : "Published Snapshot"}</strong>
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
          caption={`${number(summary.totalShows)} shows in the current selection`}
          tone="ink"
        />
        <StatCard
          eyebrow="Coverage"
          value={`${selectedTheatre === "ALL" ? theatres.length : filteredShows.length ? 1 : 0} theatres`}
          caption={`${movies.length} movies tracked in this selection`}
        />
      </section>

      <Section
        title="Movie-wise Ticket Lines"
        kicker="Every show in theatre, time, movie, tickets format"
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

      <Section title="Collector Caveats" kicker="What this version assumes">
        <div className="caveat-grid">
          <article className="caveat-card">
            <h3>Static-first architecture</h3>
            <p>
              This app reads from generated JSON files so it can be published on GitHub Pages
              without a full custom backend.
            </p>
          </article>
          <article className="caveat-card">
            <h3>Live category payload</h3>
            <p>
              The tracker prefers live `MaxSeats` and `SeatsAvail` counts when BookMyShow exposes
              them, and falls back to showtime discovery when future dates only publish schedule data.
            </p>
          </article>
          <article className="caveat-card">
            <h3>Cutoff handling</h3>
            <p>
              We prefer BookMyShow&apos;s live cutoff when present, and fall back to theatre-specific
              cutoff rules when it is missing.
            </p>
          </article>
        </div>
      </Section>

      <Notes notes={data.meta?.notes} />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
