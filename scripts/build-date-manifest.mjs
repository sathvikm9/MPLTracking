import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "public", "data");
const HISTORY_DIR = path.join(DATA_DIR, "history");
const OUTPUT_PATH = path.join(DATA_DIR, "dates.json");

function toNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
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

function buildManifestEntry(snapshot) {
  const shows = Array.isArray(snapshot?.shows) ? snapshot.shows : [];
  const theatres = summarizeShowsByTheatre(shows);
  const theatreCounts = Object.fromEntries(
    theatres.map((theatre) => [
      theatre.venueCode,
      {
        totalShows: theatre.totalShows,
        shortName: theatre.shortName,
        name: theatre.name
      }
    ])
  );

  return {
    date: snapshot.targetDate,
    dateCode: snapshot.targetDateCode || String(snapshot.targetDate || "").replaceAll("-", ""),
    generatedAt: snapshot.generatedAt || "",
    totalShows: toNumber(snapshot.summary?.totalShows || shows.length),
    theatres,
    theatreCounts,
    movies: summarizeShowsByMovie(shows)
  };
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function main() {
  const snapshotsByDate = new Map();
  const historyEntries = await fs.readdir(HISTORY_DIR, { withFileTypes: true }).catch(() => []);

  for (const entry of historyEntries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;

    const snapshot = await readJsonIfExists(path.join(HISTORY_DIR, entry.name));
    if (snapshot?.targetDate) {
      snapshotsByDate.set(snapshot.targetDate, snapshot);
    }
  }

  const latest = await readJsonIfExists(path.join(DATA_DIR, "latest.json"));
  if (latest?.targetDate) {
    snapshotsByDate.set(latest.targetDate, latest);
  }

  const dates = Array.from(snapshotsByDate.values())
    .map(buildManifestEntry)
    .filter((entry) => entry.date)
    .sort((left, right) => left.date.localeCompare(right.date));

  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    dates
  };

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        output: path.relative(ROOT, OUTPUT_PATH),
        dates: dates.map((entry) => ({
          date: entry.date,
          totalShows: entry.totalShows,
          theatres: entry.theatres.map((theatre) => theatre.venueCode)
        }))
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
