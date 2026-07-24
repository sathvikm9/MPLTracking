import { chromium as playwrightChromium } from "playwright-core";

const CITY_SLUG = "mdnp";
const INDIA_TIMEZONE = "Asia/Kolkata";
const THEATRE_DISCOVERY_TIMEOUT_MS = 45000;
const THEATRE_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 6;
const theatreSnapshotCache =
  globalThis.__MADANAPALLE_THEATRE_DISCOVERY_CACHE__ || new Map();
globalThis.__MADANAPALLE_THEATRE_DISCOVERY_CACHE__ = theatreSnapshotCache;

export const MADANAPALLE_THEATRES = [
  {
    venueCode: "ASRM",
    shortName: "ASR",
    name: "ASR A/C 4K Laser Dolby Surround 7.1: Madanapalle",
    slug: "asr-a-c-4k-laser-dolby-surround-71-madanapalle",
    fallbackCutoffMinutes: 15
  },
  {
    venueCode: "RTDM",
    shortName: "Ravi",
    name: "Ravi A/C 4K Laser Dolby Surround 7.1: Madanapalle",
    slug: "ravi-a-c-4k-laser-dolby-surround-71-madanapalle",
    fallbackCutoffMinutes: 15
  },
  {
    venueCode: "MSDR",
    shortName: "Siddartha",
    name: "Siddartha Cinemas:Screen 2 Dolby Laser,Madanapalle",
    slug: "siddartha-cinemasscreen-2-dolby-lasermadanapalle",
    fallbackCutoffMinutes: 30
  },
  {
    venueCode: "SKMD",
    shortName: "Sri Krishna",
    name: "Sri Krishna A/C 4K Dolby Atmos: Madanapalle",
    slug: "sri-krishna-a-c-4k-dolby-atmos-madanapalle",
    fallbackCutoffMinutes: 15
  }
];

export function isoToDateCode(date) {
  return String(date || "").replaceAll("-", "");
}

export function dateCodeToIso(dateCode) {
  const value = String(dateCode || "");
  if (!/^\d{8}$/.test(value)) return "";
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

export function showDateTimeToIso(value) {
  const code = String(value || "");
  if (!/^\d{12}$/.test(code)) return "";
  return `${code.slice(0, 4)}-${code.slice(4, 6)}-${code.slice(6, 8)}T${code.slice(
    8,
    10
  )}:${code.slice(10, 12)}:00+05:30`;
}

export function getIndiaTodayIso(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: INDIA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

export function addDaysIso(dateIso, days) {
  const [year, month, day] = String(dateIso).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function normalizeMovieGenres(eventGenre) {
  if (!eventGenre) return [];
  if (Array.isArray(eventGenre)) return eventGenre;
  if (typeof eventGenre === "string") return eventGenre.split("|").filter(Boolean);
  if (typeof eventGenre === "object") {
    return Object.keys(eventGenre).filter((key) => key !== "GenreMeta");
  }
  return [];
}

function bookingUrl(theatre, dateCode) {
  return `https://in.bookmyshow.com/cinemas/${CITY_SLUG}/${theatre.slug}/buytickets/${theatre.venueCode}/${dateCode}`;
}

function seatLayoutUrl(theatre, eventCode, sessionId, dateCode) {
  return `https://in.bookmyshow.com/movies/${CITY_SLUG}/seat-layout/${eventCode}/${theatre.venueCode}/${sessionId}/${dateCode}`;
}

function cacheKey(venueCode, dateIso) {
  return `${venueCode || "ALL"}:${dateIso || "dates"}`;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function readLastGood(venueCode, dateIso) {
  const cached = theatreSnapshotCache.get(cacheKey(venueCode, dateIso));
  if (!cached) return null;

  const ageMs = Date.now() - cached.cachedAtMs;
  if (ageMs > THEATRE_CACHE_MAX_AGE_MS) {
    theatreSnapshotCache.delete(cacheKey(venueCode, dateIso));
    return null;
  }

  return {
    data: cloneJson(cached.data),
    cachedAt: cached.cachedAt,
    ageMs
  };
}

function writeLastGood(venueCode, dateIso, data) {
  if (!data?.shows?.length && !data?.dateOptions?.length) return;

  theatreSnapshotCache.set(cacheKey(venueCode, dateIso), {
    data: cloneJson(data),
    cachedAt: new Date().toISOString(),
    cachedAtMs: Date.now()
  });
}

function annotateCached(data, cached, error) {
  return {
    ...data,
    meta: {
      ...(data.meta || {}),
      cache: {
        hit: true,
        cachedAt: cached.cachedAt,
        ageMs: cached.ageMs,
        reason: error.message
      },
      notes: [
        `Using last successful BookMyShow theatre-page discovery from ${cached.cachedAt}.`,
        ...((data.meta && data.meta.notes) || [])
      ]
    }
  };
}

function getTheatre(venueCode) {
  const theatre = MADANAPALLE_THEATRES.find((entry) => entry.venueCode === venueCode);
  if (!theatre) {
    const error = new Error(`Unknown Madanapalle theatre venueCode: ${venueCode}`);
    error.status = 400;
    throw error;
  }
  return theatre;
}

async function localExecutablePath() {
  try {
    const playwright = await import("playwright");
    return playwright.chromium.executablePath();
  } catch {
    return null;
  }
}

async function launchBrowser() {
  const isVercel = Boolean(process.env.VERCEL || process.env.AWS_REGION);
  let chromiumPack = null;
  if (isVercel) {
    // Vercel runs on an AWS Lambda-like runtime but does not expose the exact
    // AWS env vars that @sparticuz/chromium uses to extract AL2023 libraries.
    process.env.AWS_EXECUTION_ENV ??= "AWS_Lambda_nodejs20.x";
    chromiumPack = (await import("@sparticuz/chromium")).default;
  }
  const executablePath = isVercel
    ? await chromiumPack.executablePath()
    : await localExecutablePath();

  return playwrightChromium.launch({
    args: isVercel ? chromiumPack.args : ["--disable-quic"],
    executablePath: executablePath || undefined,
    headless: true
  });
}

function collectDateOptionsFromText(bodyText, days) {
  const tokens = String(bodyText || "")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const monthMap = new Map([
    ["JAN", "01"],
    ["FEB", "02"],
    ["MAR", "03"],
    ["APR", "04"],
    ["MAY", "05"],
    ["JUN", "06"],
    ["JUL", "07"],
    ["AUG", "08"],
    ["SEP", "09"],
    ["OCT", "10"],
    ["NOV", "11"],
    ["DEC", "12"]
  ]);
  const currentYear = Number(getIndiaTodayIso().slice(0, 4));
  const dateOptions = [];

  for (let index = 0; index < tokens.length - 2; index += 1) {
    const day = tokens[index + 1];
    const month = String(tokens[index + 2] || "").toUpperCase();
    if (!/^\d{1,2}$/.test(day) || !monthMap.has(month)) continue;

    const date = `${currentYear}-${monthMap.get(month)}-${day.padStart(2, "0")}`;
    if (!dateOptions.some((entry) => entry.date === date)) {
      dateOptions.push({
        date,
        dateCode: isoToDateCode(date)
      });
    }

    if (dateOptions.length >= days) break;
  }

  return dateOptions;
}

function collectShowsFromTransformed(theatre, transformed, requestedDateCode) {
  const events = Array.isArray(transformed?.Event) ? transformed.Event : [];
  const shows = [];

  for (const event of events) {
    const childEvents = Array.isArray(event.ChildEvents) ? event.ChildEvents : [];
    for (const childEvent of childEvents) {
      const showTimes = Array.isArray(childEvent.ShowTimes) ? childEvent.ShowTimes : [];
      for (const showTime of showTimes) {
        const showDateCode = String(showTime.ShowDateCode || requestedDateCode || "");
        if (requestedDateCode && showDateCode !== requestedDateCode) continue;

        const eventCode = showTime.EventCode || childEvent.EventCode;
        if (!eventCode || !showTime.SessionId) continue;

        shows.push({
          id: `${theatre.venueCode}-${showTime.SessionId}`,
          eventCode,
          sessionId: showTime.SessionId,
          venueCode: theatre.venueCode,
          venueName: theatre.name,
          theatreShortName: theatre.shortName,
          citySlug: CITY_SLUG,
          showDate: dateCodeToIso(showDateCode),
          showDateCode,
          showDateTime: showDateTimeToIso(showTime.ShowDateTime),
          showDateTimeCode: showTime.ShowDateTime,
          showTimeLabel: showTime.ShowTime,
          cutoffAt: showDateTimeToIso(showTime.CutOffDateTime),
          cutoffCode: showTime.CutOffDateTime || null,
          format: childEvent.EventDimension || "",
          language: childEvent.EventLang || "",
          title: childEvent.EventName || childEvent.EventTitle || event.EventTitle || "Untitled Movie",
          releaseLabel: event.EventTitle || childEvent.EventTitle || childEvent.EventName || "Untitled Movie",
          censor: childEvent.EventCensor || "",
          genres: normalizeMovieGenres(childEvent.EventGenre || event.EventGenre),
          trailerUrl: childEvent.EventTrailer || childEvent.TrailerUrl || "",
          screenName: showTime.ScreenName || theatre.shortName,
          bookingUrl: bookingUrl(theatre, showDateCode),
          seatLayoutUrl: seatLayoutUrl(theatre, eventCode, showTime.SessionId, showDateCode),
          rawCategories: Array.isArray(showTime.Categories) ? showTime.Categories : []
        });
      }
    }
  }

  return shows;
}

async function readTheatrePage({ theatre, dateIso, days }) {
  const dateCode = isoToDateCode(dateIso);
  const browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
  });
  const page = await context.newPage();

  try {
    await page.goto(bookingUrl(theatre, dateCode), {
      waitUntil: "domcontentloaded",
      timeout: THEATRE_DISCOVERY_TIMEOUT_MS
    });
    await page.waitForTimeout(2500);

    const result = await page.evaluate(
      ({ venueCode, dateCode, days }) => {
        const queries = window.__INITIAL_STATE__?.venueShowtimesFunctionalApi?.queries || {};
        const bodyText = document.body?.innerText || "";
        const queryKey = Object.keys(queries).find(
          (key) => key.includes("getShowtimesByVenue") && key.includes(venueCode) && key.includes(dateCode)
        );

        return {
          title: document.title,
          href: location.href,
          bodyText,
          dateOptions: [],
          transformed: queryKey ? queries[queryKey]?.data?.showDetailsTransformed || null : null,
          queryKeys: Object.keys(queries),
          days
        };
      },
      {
        venueCode: theatre.venueCode,
        dateCode,
        days
      }
    );

    if (/Attention Required|blocked/i.test(result.title || result.bodyText || "")) {
      throw new Error("BookMyShow theatre page was blocked by Cloudflare.");
    }

    return {
      ...result,
      dateOptions: collectDateOptionsFromText(result.bodyText, days)
    };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

export async function discoverTheatreDateShows({ venueCode, date, days = 9 }) {
  const theatre = getTheatre(venueCode);
  const targetDate = date || getIndiaTodayIso();
  const targetDateCode = isoToDateCode(targetDate);

  try {
    const pageData = await readTheatrePage({ theatre, dateIso: targetDate, days });
    const shows = collectShowsFromTransformed(theatre, pageData.transformed, targetDateCode);
    const data = {
      theatre,
      targetDate,
      targetDateCode,
      dateOptions: pageData.dateOptions,
      shows,
      meta: {
        source: "bookmyshow-theatre-page",
        liveDiscovery: true,
        cache: {
          hit: false
        },
        pageTitle: pageData.title,
        queryKeys: pageData.queryKeys
      }
    };

    writeLastGood(venueCode, targetDate, data);
    return data;
  } catch (error) {
    const cached = readLastGood(venueCode, targetDate);
    if (cached) return annotateCached(cached.data, cached, error);
    throw error;
  }
}

export async function discoverTheatreDates({ venueCode, days = 9 }) {
  const theatre = getTheatre(venueCode);
  const today = getIndiaTodayIso();

  try {
    const pageData = await readTheatrePage({ theatre, dateIso: today, days });
    const discoveredDates = pageData.dateOptions.length
      ? pageData.dateOptions
      : Array.from({ length: days }, (_, index) => {
          const date = addDaysIso(today, index);
          return {
            date,
            dateCode: isoToDateCode(date)
          };
        });
    const data = {
      theatre,
      targetDate: today,
      dateOptions: discoveredDates.slice(0, days),
      shows: collectShowsFromTransformed(theatre, pageData.transformed, isoToDateCode(today)),
      meta: {
        source: "bookmyshow-theatre-page",
        liveDiscovery: true,
        cache: {
          hit: false
        },
        pageTitle: pageData.title,
        queryKeys: pageData.queryKeys
      }
    };

    writeLastGood(venueCode, "", data);
    return data;
  } catch (error) {
    const cached = readLastGood(venueCode, "");
    if (cached) return annotateCached(cached.data, cached, error);
    throw error;
  }
}
