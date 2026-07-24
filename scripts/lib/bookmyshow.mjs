import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

import {
  dateCodeToIsoTimestamp,
  formatGeneratedAt,
  inferCutoffIso,
  toIsoFromDateCode
} from "./date.mjs";

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, "config", "city.json");
const OUTPUT_PATH = path.join(ROOT, "public", "data", "latest.json");
const HISTORY_DIR = path.join(ROOT, "public", "data", "history");
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

function normalizeMovieGenres(eventGenre) {
  if (!eventGenre) return [];
  if (Array.isArray(eventGenre)) return eventGenre;
  if (typeof eventGenre === "string") return eventGenre.split("|").filter(Boolean);
  if (typeof eventGenre === "object") {
    return Object.keys(eventGenre).filter((key) => key !== "GenreMeta");
  }
  return [];
}

function categoryKeyFromLabel(label) {
  return label.replace(/\s*-\s*₹.*$/, "").trim();
}

function priceFromCategoryLabel(label) {
  const match = label.match(/₹\s*([\d.]+)/);
  return match ? Number(match[1]) : 0;
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === null || value === undefined || value === "") return 0;

  const cleaned = String(value).replace(/[^\d.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildBookingUrl(citySlug, theatre, dateCode) {
  return `https://in.bookmyshow.com/cinemas/${citySlug}/${theatre.slug}/buytickets/${theatre.venueCode}/${dateCode}`;
}

function buildSeatLayoutUrl(citySlug, eventCode, venueCode, sessionId, dateCode) {
  return `https://in.bookmyshow.com/movies/${citySlug}/seat-layout/${eventCode}/${venueCode}/${sessionId}/${dateCode}`;
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

function normalizeDiscoveredCategories(rawCategories) {
  const categories = Array.isArray(rawCategories) ? rawCategories : [];

  return categories.map((category) => ({
    name: category.PriceDesc || category.name || "Category",
    label: category.label || category.PriceDesc || category.name || "Category",
    price: toNumber(category.CurPrice || category.price || category.Price || 0),
    totalSeats: 0,
    availableSeats: 0,
    soldSeats: 0,
    unknownSeats: 0,
    rows: []
  }));
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

async function fetchShowtimeApiPayload(eventCode, regionCode, dateCode) {
  let lastError = null;

  for (const baseUrl of SHOWTIME_API_BASE_URLS) {
    try {
      const url = new URL(baseUrl);
      url.searchParams.set("eventCode", eventCode);
      url.searchParams.set("regionCode", regionCode);
      url.searchParams.set("dateCode", dateCode);

      const response = await fetch(url, {
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

function buildApiSnapshotsFromPayload(config, payload, theatreMap, citySlug) {
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
        const childEvent =
          childEventsByCode.get(showTime.EventCode) || childEvents[0] || showDetail?.Event || {};
        const categories = normalizeAvailabilityCategories(showTime.Categories);

        if (!hasAvailabilityMetrics(categories)) {
          continue;
        }

        const show = {
          id: `${theatre.venueCode}-${showTime.SessionId}`,
          eventCode: showTime.EventCode || childEvent.EventCode,
          sessionId: showTime.SessionId,
          venueCode: theatre.venueCode,
          venueName: theatre.name,
          theatreShortName: theatre.shortName,
          citySlug,
          showDate: toIsoFromDateCode(showTime.ShowDateCode || showDetail.Date),
          showDateCode: showTime.ShowDateCode || showDetail.Date,
          showDateTime: dateCodeToIsoTimestamp(showTime.ShowDateTime),
          showDateTimeCode: showTime.ShowDateTime,
          showTimeLabel: showTime.ShowTime,
          cutoffAt: inferCutoffIso(
            showTime.ShowDateTime,
            showTime.CutOffDateTime,
            theatre.fallbackCutoffMinutes
          ),
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
          bookingUrl: buildBookingUrl(citySlug, theatre, showTime.ShowDateCode || showDetail.Date),
          seatLayoutUrl: buildSeatLayoutUrl(
            citySlug,
            showTime.EventCode || childEvent.EventCode,
            theatre.venueCode,
            showTime.SessionId,
            showTime.ShowDateCode || showDetail.Date
          )
        };

        snapshots.push(buildSnapshotFromCategories(show, categories, "bms-india-showtimes"));
      }
    }
  }

  return snapshots;
}

function buildFallbackSnapshots(discoveredShows) {
  return discoveredShows
    .map((show) => {
      const categories = normalizeAvailabilityCategories(show.rawCategories);

      if (hasAvailabilityMetrics(categories)) {
        return buildSnapshotFromCategories(show, categories, "bookmyshow-theatre-discovery");
      }

      return buildSnapshotFromCategories(
        show,
        normalizeDiscoveredCategories(show.rawCategories),
        "bookmyshow-showtime-discovery"
      );
    });
}

function collectShowsFromTransformedData(theatre, transformed, dateCode, citySlug) {
  const eventBlocks = Array.isArray(transformed?.Event) ? transformed.Event : [];
  const shows = [];

  for (const eventBlock of eventBlocks) {
    const childEvents = Array.isArray(eventBlock.ChildEvents) ? eventBlock.ChildEvents : [];

    for (const childEvent of childEvents) {
      const showTimes = Array.isArray(childEvent.ShowTimes) ? childEvent.ShowTimes : [];

      for (const showTime of showTimes) {
        const eventCode = childEvent.EventCode;
        const sessionId = showTime.SessionId;
        const categories = Array.isArray(showTime.Categories) ? showTime.Categories : [];

        shows.push({
          id: `${theatre.venueCode}-${sessionId}`,
          eventCode,
          sessionId,
          venueCode: theatre.venueCode,
          venueName: theatre.name,
          theatreShortName: theatre.shortName,
          citySlug,
          showDate: toIsoFromDateCode(showTime.ShowDateCode || dateCode),
          showDateCode: showTime.ShowDateCode || dateCode,
          showDateTime: dateCodeToIsoTimestamp(showTime.ShowDateTime),
          showDateTimeCode: showTime.ShowDateTime,
          showTimeLabel: showTime.ShowTime,
          cutoffAt: inferCutoffIso(
            showTime.ShowDateTime,
            showTime.CutOffDateTime,
            theatre.fallbackCutoffMinutes
          ),
          cutoffCode: showTime.CutOffDateTime || null,
          format: childEvent.EventDimension || "",
          language: childEvent.EventLang || "",
          title: childEvent.EventName || childEvent.EventTitle || eventBlock.EventTitle,
          releaseLabel: eventBlock.EventTitle,
          censor: childEvent.EventCensor || "",
          genres: normalizeMovieGenres(childEvent.EventGenre),
          trailerUrl: childEvent.EventTrailer || childEvent.TrailerUrl || "",
          screenName: showTime.ScreenName || theatre.shortName,
          bookingUrl: buildBookingUrl(citySlug, theatre, dateCode),
          seatLayoutUrl: buildSeatLayoutUrl(citySlug, eventCode, theatre.venueCode, sessionId, dateCode),
          rawCategories: categories
        });
      }
    }
  }

  return shows;
}

async function openAccessibilityModal(page) {
  const selectSeatsButton = page.getByRole("button", { name: /^select seats$/i });
  const selectSeatsVisible = await selectSeatsButton.first().isVisible().catch(() => false);

  if (selectSeatsVisible) {
    await selectSeatsButton.first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(1200);
  }

  const accessibilityButton = page.getByRole("button", {
    name: /open accessibility seat selection/i
  });

  await accessibilityButton.waitFor({ timeout: 30000 });
  await dismissObstructiveOverlays(page);
  await accessibilityButton.click({ force: true }).catch(async () => {
    await page.evaluate(() => {
      const button = document.querySelector('button[aria-label="Open accessibility seat selection"]');
      button?.click();
    });
  });

  const quantity = page.locator('select[aria-label="Select number of tickets, required"]');
  await quantity.waitFor({ timeout: 30000 });
  await quantity.selectOption({ label: "1 Ticket" }).catch(async () => {
    await quantity.selectOption("1");
  });
}

async function dismissObstructiveOverlays(page) {
  const continueButton = page.getByRole("button", { name: /continue/i });
  const closeButton = page.locator('#bottomSheet-model-close, [data-testid="modalClose"]');

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const continueVisible = await continueButton.first().isVisible().catch(() => false);
    if (continueVisible) {
      await continueButton.first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(300);
    }

    const closeVisible = await closeButton.first().isVisible().catch(() => false);
    if (closeVisible) {
      await closeButton.first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(300);
    }

    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(150);
  }
}

async function gotoWithRetries(page, url) {
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60000
      });

      await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await page.waitForTimeout(1000 * attempt);
      }
    }
  }

  throw lastError;
}

async function extractSeatSnapshot(page) {
  const categorySelect = page.locator('select[aria-label="Select seat category"]');
  const rowSelect = page.locator('select[aria-label="Select row"]');

  const categoryOptions = await categorySelect.evaluate((element) =>
    Array.from(element.options)
      .map((option) => ({
        value: option.value,
        label: option.label
      }))
      .filter((option) => option.value && !/select category/i.test(option.label))
  );

  const categories = [];

  for (const category of categoryOptions) {
    await categorySelect.selectOption(category.value);
    await page.waitForTimeout(200);

    const rowOptions = await rowSelect.evaluate((element) =>
      Array.from(element.options)
        .map((option) => ({
          value: option.value,
          label: option.label
        }))
        .filter((option) => option.value && !/select row/i.test(option.label))
    );

    const categorySummary = {
      name: categoryKeyFromLabel(category.label),
      label: category.label,
      price: priceFromCategoryLabel(category.label),
      rows: [],
      totalSeats: 0,
      availableSeats: 0,
      soldSeats: 0,
      unknownSeats: 0
    };

    for (const row of rowOptions) {
      await rowSelect.selectOption(row.value);
      await page.waitForTimeout(150);

      const seatRecords = await page.evaluate(() => {
        const grid = document.querySelector('[aria-label^="Seats for Row"]');
        if (!grid) return [];

        return Array.from(grid.querySelectorAll("[aria-label]")).map((element) => ({
          ariaLabel: element.getAttribute("aria-label") || "",
          ariaDisabled: element.getAttribute("aria-disabled") || "false",
          ariaPressed: element.getAttribute("aria-pressed") || "false",
          text: (element.textContent || "").trim(),
          tagName: element.tagName
        }));
      });

      let availableSeats = 0;
      let soldSeats = 0;
      let unknownSeats = 0;

      for (const seat of seatRecords) {
        const label = seat.ariaLabel.toLowerCase();
        const disabled = seat.ariaDisabled === "true";
        const pressed = seat.ariaPressed === "true";

        if (label.includes("select seat") && !disabled && !pressed) {
          availableSeats += 1;
          continue;
        }

        if (
          disabled ||
          label.includes("sold") ||
          label.includes("unavailable") ||
          label.includes("booked") ||
          label.includes("taken")
        ) {
          soldSeats += 1;
          continue;
        }

        unknownSeats += 1;
      }

      categorySummary.rows.push({
        name: row.label,
        totalSeats: availableSeats + soldSeats + unknownSeats,
        availableSeats,
        soldSeats,
        unknownSeats
      });

      categorySummary.totalSeats += availableSeats + soldSeats + unknownSeats;
      categorySummary.availableSeats += availableSeats;
      categorySummary.soldSeats += soldSeats;
      categorySummary.unknownSeats += unknownSeats;
    }

    categories.push(categorySummary);
  }

  return categories;
}

async function collectShowSnapshot(page, show) {
  await gotoWithRetries(page, show.seatLayoutUrl);
  await openAccessibilityModal(page);

  const categories = await extractSeatSnapshot(page);
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
      method: "bookmyshow-accessibility-modal",
      capturedAt: new Date().toISOString()
    }
  };
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

export async function loadConfig() {
  const raw = await fs.readFile(CONFIG_PATH, "utf8");
  return JSON.parse(raw);
}

export async function collectSampleData(targetDate) {
  const config = await loadConfig();

  const shows = [
    {
      id: "MSDR-11945",
      eventCode: "ET00496966",
      sessionId: "11945",
      venueCode: "MSDR",
      venueName: "Siddartha Cinemas:Screen 2 Dolby Laser,Madanapalle",
      theatreShortName: "Siddartha",
      title: "Kara (Telugu) - Telugu",
      releaseLabel: "Kara",
      language: "Telugu",
      format: "2D",
      censor: "UA16+",
      genres: ["Action", "Thriller"],
      showDate: targetDate.isoDate,
      showDateCode: targetDate.dateCode,
      showTimeLabel: "11:15 AM",
      showDateTime: `${targetDate.isoDate}T05:45:00.000Z`,
      cutoffAt: `${targetDate.isoDate}T06:15:00.000Z`,
      totalSeats: 271,
      availableSeats: 198,
      soldSeats: 73,
      unknownSeats: 0,
      gross: 7449,
      occupancyPercent: 26.94,
      categories: [
        {
          name: "Gold Class",
          price: 105,
          totalSeats: 238,
          availableSeats: 174,
          soldSeats: 64,
          unknownSeats: 0,
          rows: []
        },
        {
          name: "Silver Class",
          price: 84,
          totalSeats: 33,
          availableSeats: 24,
          soldSeats: 9,
          unknownSeats: 0,
          rows: []
        }
      ],
      source: {
        method: "sample-data",
        capturedAt: new Date().toISOString()
      }
    }
  ];

  return buildOutput(config, targetDate, shows, [
    "Sample mode was used. Run `npm run collect` for live BookMyShow data."
  ]);
}

function buildOutput(config, targetDate, shows, notes = []) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    generatedAtLabel: formatGeneratedAt(),
    targetDate: targetDate.isoDate,
    targetDateCode: targetDate.dateCode,
    timezone: config.city.timezone,
    city: config.city,
    summary: buildSummary(shows),
    movies: summarizeByMovie(shows),
    theatres: summarizeByTheatre(shows),
    shows: shows.sort((left, right) => left.showDateTime.localeCompare(right.showDateTime)),
    meta: {
      status: "ok",
      notes
    }
  };
}

export async function collectLiveData(targetDate, options = {}) {
  const config = await loadConfig();
  const citySlug = config.city.bmsSlug || config.city.slug;
  const theatres = options.theatre
    ? config.theatres.filter((theatre) => theatre.venueCode === options.theatre)
    : config.theatres.filter((theatre) => theatre.active !== false);

  const launchOptions = {
    headless: process.env.BMS_HEADLESS === "true",
    slowMo: process.env.BMS_SLOWMO ? Number(process.env.BMS_SLOWMO) : 0,
    args: ["--disable-quic"]
  };
  const discoveredShows = [];
  const notes = [];
  const theatreMap = new Map(theatres.map((theatre) => [theatre.venueCode, theatre]));

  for (const theatre of theatres) {
    let discoveryBrowser = null;
    let discoveryContext = null;
    let discoveryPage = null;
    try {
      discoveryBrowser = await chromium.launch(launchOptions);
      discoveryContext = await discoveryBrowser.newContext({
        viewport: { width: 1440, height: 1080 }
      });
      discoveryPage = await discoveryContext.newPage();
      const bookingUrl = buildBookingUrl(citySlug, theatre, targetDate.dateCode);
      await discoveryPage.goto(bookingUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000
      });

      await discoveryPage.waitForFunction(
        ({ venueCode, dateCode }) => {
          const queries = window.__INITIAL_STATE__?.venueShowtimesFunctionalApi?.queries || {};
          return Object.keys(queries).some(
            (queryKey) =>
              queryKey.includes("getShowtimesByVenue") &&
              queryKey.includes(venueCode) &&
              queryKey.includes(dateCode)
          );
        },
        {
          venueCode: theatre.venueCode,
          dateCode: targetDate.dateCode
        },
        { timeout: 30000 }
      );

      const transformed = await discoveryPage.evaluate(
        ({ venueCode, dateCode }) => {
          const queries = window.__INITIAL_STATE__?.venueShowtimesFunctionalApi?.queries || {};
          const key = Object.keys(queries).find(
            (queryKey) =>
              queryKey.includes("getShowtimesByVenue") &&
              queryKey.includes(venueCode) &&
              queryKey.includes(dateCode)
          );
          return key ? queries[key]?.data?.showDetailsTransformed || null : null;
        },
        {
          venueCode: theatre.venueCode,
          dateCode: targetDate.dateCode
        }
      );

      if (!transformed) {
        notes.push(`No showtime payload found for ${theatre.shortName}.`);
        continue;
      }

      discoveredShows.push(
        ...collectShowsFromTransformedData(theatre, transformed, targetDate.dateCode, citySlug)
      );
    } catch (error) {
      notes.push(`Failed to discover shows for ${theatre.shortName}: ${error.message}`);
    } finally {
      await discoveryPage?.close().catch(() => {});
      await discoveryContext?.close().catch(() => {});
      await discoveryBrowser?.close().catch(() => {});
    }
  }

  if (!discoveredShows.length) {
    notes.push("No shows were discovered for the requested theatre set.");
  }

  const snapshotsById = new Map();
  for (const snapshot of buildFallbackSnapshots(discoveredShows)) {
    snapshotsById.set(snapshot.id, snapshot);
  }

  const uniqueEventCodes = [...new Set(discoveredShows.map((show) => show.eventCode).filter(Boolean))];
  for (const eventCode of uniqueEventCodes) {
    try {
      const payload = await fetchShowtimeApiPayload(
        eventCode,
        config.city.regionCode,
        targetDate.dateCode
      );

      for (const snapshot of buildApiSnapshotsFromPayload(config, payload, theatreMap, citySlug)) {
        snapshotsById.set(snapshot.id, snapshot);
      }
    } catch (error) {
      notes.push(`Showtime API fallback failed for ${eventCode}: ${error.message}`);
    }
  }

  const missingShows = discoveredShows.filter((show) => !snapshotsById.has(show.id));
  if (missingShows.length) {
    notes.push(
      `No live availability payload was captured for ${missingShows.length} discovered show(s).`
    );
  }

  return buildOutput(config, targetDate, Array.from(snapshotsById.values()), notes);
}

export async function writeOutput(data) {
  await fs.mkdir(HISTORY_DIR, { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fs.writeFile(
    path.join(HISTORY_DIR, `${data.targetDate}.json`),
    `${JSON.stringify(data, null, 2)}\n`,
    "utf8"
  );
}
