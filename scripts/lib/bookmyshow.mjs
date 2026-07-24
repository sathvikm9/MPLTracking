import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

import { formatGeneratedAt } from "./date.mjs";
import { discoverTheatreDateShows } from "../../proxy-vercel/shared/theatre-discovery.mjs";

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, "config", "city.json");
const OUTPUT_PATH = path.join(ROOT, "public", "data", "latest.json");
const HISTORY_DIR = path.join(ROOT, "public", "data", "history");
const BMS_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

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

function buildOutput(config, targetDate, shows, notes = [], meta = {}) {
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
      status: meta.status || "ok",
      notes,
      ...meta
    }
  };
}

export async function collectLiveData(targetDate, options = {}) {
  const config = await loadConfig();
  const theatres = config.theatres.filter(
    (theatre) =>
      theatre.active !== false &&
      theatre.platform !== "ticketnew" &&
      (!options.theatre || theatre.venueCode === options.theatre)
  );

  if (options.theatre && theatres.length === 0) {
    throw new Error(`Unknown or non-BookMyShow theatre: ${options.theatre}`);
  }

  const launchOptions = {
    headless: process.env.BMS_HEADLESS === "true",
    slowMo: process.env.BMS_SLOWMO ? Number(process.env.BMS_SLOWMO) : 0,
    args: ["--disable-quic"]
  };
  const discoveredShows = [];
  const notes = [];

  for (const theatre of theatres) {
    try {
      const discovered = await discoverTheatreDateShows({
        venueCode: theatre.venueCode,
        date: targetDate.isoDate,
        days: 3
      });

      if (discovered.targetDate !== targetDate.isoDate) {
        throw new Error(
          `BookMyShow returned ${discovered.targetDate} instead of ${targetDate.isoDate}`
        );
      }

      if (discovered.meta?.cache?.hit) {
        notes.push(
          `${theatre.shortName} show discovery used a cached response from ${discovered.meta.cache.cachedAt}.`
        );
      }

      if (!discovered.shows.length) {
        notes.push(
          `${theatre.shortName} returned 0 BookMyShow shows for ${targetDate.isoDate} (${discovered.meta?.pageTitle || "unknown page title"}).`
        );
      }

      discoveredShows.push(...discovered.shows);
    } catch (error) {
      notes.push(`Failed to discover shows for ${theatre.shortName}: ${error.message}`);
    }
  }

  if (!discoveredShows.length) {
    notes.push("No shows were discovered for the requested theatre set.");
    return buildOutput(config, targetDate, [], notes, {
      status: "error",
      discovery: {
        requestedTheatres: theatres.length,
        discoveredTheatres: 0,
        discoveredShows: 0
      },
      availability: {
        capturedShows: 0,
        missingShows: 0
      }
    });
  }

  const snapshotsById = new Map();
  for (const show of discoveredShows) {
    const categories = normalizeAvailabilityCategories(show.rawCategories);
    if (hasAvailabilityMetrics(categories)) {
      snapshotsById.set(
        show.id,
        buildSnapshotFromCategories(show, categories, "bookmyshow-theatre-discovery")
      );
    }
  }

  const showsNeedingSeatCapture = discoveredShows.filter((show) => !snapshotsById.has(show.id));
  let browser = null;

  if (showsNeedingSeatCapture.length) {
    try {
      browser = await chromium.launch(launchOptions);

      for (const show of showsNeedingSeatCapture) {
        let lastError = null;

        for (let attempt = 1; attempt <= 2; attempt += 1) {
          let context = null;
          let page = null;
          try {
            context = await browser.newContext({
              viewport: { width: 1440, height: 1080 },
              userAgent: BMS_BROWSER_USER_AGENT
            });
            page = await context.newPage();

            const snapshot = await collectShowSnapshot(page, show);
            if (!snapshot.totalSeats) {
              throw new Error("seat layout returned no seats");
            }
            snapshotsById.set(snapshot.id, snapshot);
            lastError = null;
            break;
          } catch (error) {
            lastError = error;
            if (attempt < 2) {
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          } finally {
            await page?.close().catch(() => {});
            await context?.close().catch(() => {});
          }
        }

        if (lastError) {
          notes.push(
            `Failed to capture live seats for ${show.theatreShortName} ${show.showTimeLabel} after 2 attempts: ${lastError.message}`
          );
        }
      }
    } catch (error) {
      notes.push(`Failed to start the BookMyShow seat collector: ${error.message}`);
    } finally {
      await browser?.close().catch(() => {});
    }
  }

  const missingShows = discoveredShows.filter((show) => !snapshotsById.has(show.id));
  if (missingShows.length) {
    notes.push(
      `Live seat availability is missing for ${missingShows.length} of ${discoveredShows.length} discovered show(s).`
    );
  }

  for (const show of missingShows) {
    snapshotsById.set(
      show.id,
      buildSnapshotFromCategories(
        show,
        normalizeDiscoveredCategories(show.rawCategories),
        "bookmyshow-showtime-discovery"
      )
    );
  }

  const discoveredTheatres = new Set(discoveredShows.map((show) => show.venueCode)).size;
  return buildOutput(config, targetDate, Array.from(snapshotsById.values()), notes, {
    status: missingShows.length ? "partial" : "ok",
    discovery: {
      requestedTheatres: theatres.length,
      discoveredTheatres,
      discoveredShows: discoveredShows.length
    },
    availability: {
      capturedShows: discoveredShows.length - missingShows.length,
      missingShows: missingShows.length
    }
  });
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
