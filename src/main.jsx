import React from "react";
import ReactDOM from "react-dom/client";

import "./styles.css";

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
      timeZone: data?.timezone || "Asia/Kolkata"
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

function useDashboardData() {
  const [state, setState] = React.useState({
    loading: true,
    error: null,
    data: null,
    refreshing: false
  });

  const loadData = React.useCallback((mode = "initial") => {
    const snapshotUrl = `./data/latest.json?ts=${Date.now()}`;
    const isInitial = mode === "initial";

    setState((current) => ({
      ...current,
      loading: isInitial ? true : current.loading,
      refreshing: !isInitial,
      error: null
    }));

    return fetch(snapshotUrl, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load data: ${response.status}`);
        }

        return response.json();
      })
      .then((data) => ({ ok: true, data }))
      .catch((error) => ({ ok: false, error }));
  }, []);

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

function MovieWiseBoard({ shows }) {
  const groups = buildMovieWiseGroups(shows);

  if (!groups.length) {
    return <div className="empty-state">No show snapshots yet.</div>;
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
  const { loading, error, data, refreshing, refresh } = useDashboardData();

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

  const summary = data.summary || {};
  const shows = data.shows || [];
  const movies = data.movies || [];
  const theatres = data.theatres || [];
  const generatedLabel = formatGeneratedAt(data);
  const ageLabel = snapshotAgeLabel(data.generatedAt);

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="hero__content">
          <p className="hero__eyebrow">Madanapalle Live Tracker</p>
          <h1>City-wide BookMyShow tracking built for Madanapalle.</h1>
          <p className="hero__lede">
            Static-site friendly dashboard powered by generated JSON snapshots. The current data
            source uses BookMyShow theatre discovery plus live category availability payloads in
            the same shape used by BFilmy-style trackers.
          </p>
          <div className="hero__actions">
            <button className="refresh-button" onClick={refresh} disabled={refreshing}>
              {refreshing ? "Checking..." : "Check for newer snapshot"}
            </button>
            <p className="hero__note">
              Browser refresh only reloads the latest published JSON. On GitHub Pages, new numbers
              appear after the collector runs and a fresh deploy is published.
            </p>
          </div>
        </div>
        <div className="hero__meta">
          <div className="meta-pill">
            <span>Target Date</span>
            <strong>{data.targetDate || "Unknown"}</strong>
          </div>
          <div className="meta-pill">
            <span>Snapshot Generated</span>
            <strong>{generatedLabel}</strong>
            <small>{ageLabel}</small>
          </div>
          <div className="meta-pill">
            <span>Timezone</span>
            <strong>{data.timezone}</strong>
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
          caption={`${number(summary.totalShows)} shows in the current snapshot`}
          tone="ink"
        />
        <StatCard
          eyebrow="Coverage"
          value={`${theatres.length} theatres`}
          caption={`${movies.length} movies tracked in this dataset`}
        />
      </section>

      <Section
        title="Movie-wise Ticket Lines"
        kicker="Every show in theatre, time, movie, tickets format"
        aside={<span className="section__hint">{shows.length} show lines</span>}
      >
        <MovieWiseBoard shows={shows} />
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
                    {movie.language} · {movie.format} · {movie.venueCount} venues
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
          emptyMessage="No movie data yet."
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
          emptyMessage="No theatre totals yet."
        />
      </Section>

      <Section
        title="Show Ledger"
        kicker="Every show captured in the latest run"
        aside={<span className="section__hint">{shows.length} show snapshots</span>}
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
              render: (show) => currency(show.gross)
            }
          ]}
          rows={shows}
          emptyMessage="No show snapshots yet."
        />
      </Section>

      <Section title="Collector Caveats" kicker="What this version assumes">
        <div className="caveat-grid">
          <article className="caveat-card">
            <h3>Static-first architecture</h3>
            <p>
              This app reads from generated JSON files so it can be published on GitHub Pages
              without a live backend.
            </p>
          </article>
          <article className="caveat-card">
            <h3>Live category payload</h3>
            <p>
              The collector prefers live `MaxSeats` and `SeatsAvail` category counts, then derives
              sold seats from the same BookMyShow-style showtime data model used by box-office
              trackers.
            </p>
          </article>
          <article className="caveat-card">
            <h3>Cutoff handling</h3>
            <p>
              We prefer BookMyShow's live cutoff when present, and fall back to theatre-specific
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
