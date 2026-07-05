const INDIA_TIMEZONE = "Asia/Kolkata";
const TICKETNEW_BASE_URL =
  "https://ticketnew.com/movies/madanapalle/sai-chitra-theatre-a-c-4k-laser-dolby-surround-7-madanapalle-c/4903";
const DISTRICT_BASE_URL =
  "https://www.district.in/movies/sai-chitra-theatre-a-c-4k-laser-dolby-surround-7-madanapalle-in-madanapalle-CD4903";
const SELECT_SEAT_URL = "https://api.edition.in/gw/consumer/movies/v1/select-seat";
const QUERY_PARAMS = {
  site_id: "6",
  client_id: "ticketnew",
  clientId: "ticketnew",
  child_site_id: "370",
  channel: "WEBAPPTICKETNEW"
};
const AVAILABLE_SEAT_STATUSES = new Set([0, 1000, 1001, 1002]);
const SAI_CHITRA_DEFAULT_BLOCKED_SEATS_PER_SHOW = 19;

export const SAI_CHITRA_THEATRE = {
  venueCode: "SAIC",
  shortName: "Sai Chitra",
  name: "Sai Chitra Theatre A/C 4K Laser Dolby Surround 7: Madanapalle",
  platform: "ticketnew",
  cinemaId: 4903,
  sourceUrl: TICKETNEW_BASE_URL,
  districtUrl: DISTRICT_BASE_URL
};

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function netTicketPrice(price) {
  return Math.max(toNumber(price) - 5, 0);
}

function dateCodeToIso(dateCode) {
  const value = String(dateCode || "");
  if (!/^\d{8}$/.test(value)) return "";
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function isoToDateCode(date) {
  return String(date || "").replaceAll("-", "");
}

function formatIndiaParts(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: INDIA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour === "24" ? "00" : map.hour,
    minute: map.minute
  };
}

function formatTimeLabel(date) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: INDIA_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  })
    .format(date)
    .replace(/\s/g, " ")
    .toUpperCase();
}

function epochFromSessionId(sessionId) {
  const epoch = Number(String(sessionId || "").split("__")[1]);
  return Number.isFinite(epoch) && epoch > 0 ? epoch : 0;
}

function indiaDateInfoFromSession(session) {
  const epoch = epochFromSessionId(session?.sid);
  const date = epoch ? new Date(epoch * 1000) : new Date(`${session?.showTime || ""}:00Z`);
  const parts = formatIndiaParts(date);
  const showDate = `${parts.year}-${parts.month}-${parts.day}`;
  const showDateCode = isoToDateCode(showDate);
  const showDateTimeCode = `${showDateCode}${parts.hour}${parts.minute}`;

  return {
    showDate,
    showDateCode,
    showDateTime: `${showDate}T${parts.hour}:${parts.minute}:00+05:30`,
    showDateTimeCode,
    showTimeLabel: formatTimeLabel(date)
  };
}

function ticketnewHeaders(extra = {}) {
  return {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json; charset=utf-8",
    origin: "https://ticketnew.com",
    referer: `${TICKETNEW_BASE_URL}`,
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    "x-app-type": "ticketnew_web",
    api_source: "ticketnew",
    "x-guest-token": `${Date.now()}_${Math.floor(1e18 * Math.random())}_${Math.random()
      .toString(36)
      .slice(2, 34)}`,
    ...extra
  };
}

function selectSeatUrl() {
  const url = new URL(SELECT_SEAT_URL);
  for (const [key, value] of Object.entries(QUERY_PARAMS)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function extractNextData(html) {
  const match = String(html || "").match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!match) {
    throw new Error("TicketNew page did not expose __NEXT_DATA__.");
  }
  return JSON.parse(match[1]);
}

function findCinemaSessions(nextData, date) {
  const movies = nextData?.props?.pageProps?.initialState?.movies;
  const serverState = nextData?.props?.pageProps?.data?.serverState;
  const candidates = [
    movies?.cinemaSessions,
    serverState?.cinemaSessions
  ].filter(Boolean);

  for (const sessionsByKey of candidates) {
    const directKey = `${SAI_CHITRA_THEATRE.cinemaId}${date}`;
    if (sessionsByKey[directKey]) return sessionsByKey[directKey];
    if (sessionsByKey[String(SAI_CHITRA_THEATRE.cinemaId)]) {
      return sessionsByKey[String(SAI_CHITRA_THEATRE.cinemaId)];
    }
    const matchingKey = Object.keys(sessionsByKey).find((key) =>
      key.startsWith(String(SAI_CHITRA_THEATRE.cinemaId))
    );
    if (matchingKey) return sessionsByKey[matchingKey];
  }

  throw new Error("TicketNew cinema sessions were not found.");
}

function buildSessionMovieMap(cinemaSessions) {
  const map = new Map();
  for (const group of cinemaSessions?.arrangedSessions || []) {
    for (const session of group.sessions || []) {
      map.set(session.sid, {
        contentId: group.entityCode || session.contentId,
        title: group.entityName || group.data?.name || "Untitled Movie",
        censor: group.data?.censor || "",
        genres: group.data?.genre || group.data?.grn || [],
        language: session.lang || session.languageLabel || group.data?.lang || "",
        format: session.scrnFmt || group.data?.scrnFmt?.[0] || "2D"
      });
    }
  }
  return map;
}

function fallbackMovieFromArrangedSessions(cinemaSessions) {
  const groups = (cinemaSessions?.arrangedSessions || []).filter(
    (group) => group?.entityCode || group?.entityName || group?.data?.name
  );
  if (groups.length !== 1) return null;

  const group = groups[0];
  return {
    contentId: group.entityCode,
    title: group.entityName || group.data?.name || "Untitled Movie",
    censor: group.data?.censor || "",
    genres: group.data?.genre || group.data?.grn || [],
    language: group.data?.lang || "",
    format: group.data?.scrnFmt?.[0] || "2D"
  };
}

async function fetchTheatrePage({ date, fetchImpl }) {
  const url = new URL(TICKETNEW_BASE_URL);
  if (date) url.searchParams.set("fromdate", date);
  url.searchParams.set("_", String(Date.now()));

  const response = await fetchImpl(url, {
    cache: "no-store",
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "cache-control": "no-cache",
      pragma: "no-cache",
      "user-agent": ticketnewHeaders()["user-agent"]
    }
  });

  if (!response.ok) {
    throw new Error(`TicketNew theatre page failed: ${response.status} ${response.statusText}`);
  }

  return {
    html: await response.text(),
    url: url.toString()
  };
}

async function fetchSeatMap({ session, movie, fetchImpl }) {
  const body = {
    cinemaId: session.cid,
    sessionId: session.sid,
    providerId: session.pid,
    screenOnTop: session.sTop || false,
    freeSeating: Boolean(session.freeSeating),
    screenFormat: session.scrnFmt || "2D",
    moviecode: session.mid,
    config: {
      socialDistancing: 1
    },
    retrieve: false,
    contentId: String(movie?.contentId || session.contentId || "")
  };

  const response = await fetchImpl(selectSeatUrl(), {
    method: "POST",
    cache: "no-store",
    headers: ticketnewHeaders(),
    body: JSON.stringify(body)
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`TicketNew seat layout failed: ${response.status} ${text.slice(0, 120)}`);
  }

  const payload = text ? JSON.parse(text) : {};
  if (payload?.error || !payload?.seatLayout) {
    throw new Error(payload?.message || "TicketNew seat layout was empty.");
  }

  return payload;
}

function priceForArea(session, area) {
  const areaCode = String(area?.AreaCode || area?.areaCatCode || "");
  const matchingSessionArea = (session?.areas || []).find(
    (entry) => String(entry.code || entry.AreaCode || "") === areaCode
  );
  return toNumber(
    area?.AreaPrice ||
      area?.price ||
      area?.priceDetails?.price ||
      matchingSessionArea?.price ||
      matchingSessionArea?.AreaPrice ||
      0
  );
}

function categoriesFromSeatMap(session, seatMapPayload) {
  const objAreas = seatMapPayload?.seatLayout?.colAreas?.objArea;
  const areas = Array.isArray(objAreas) ? objAreas : [];

  if (!areas.length && Array.isArray(session?.areas)) {
    return session.areas.map((area) => {
      const totalSeats = toNumber(area.sTotal || area.seatsTotal || area.totalSeats);
      const availableSeats = toNumber(area.sAvail || area.seatsAvail || area.availableSeats);
      return {
        name: area.label || area.description || "Category",
        label: area.label || area.description || "Category",
        price: toNumber(area.price),
        totalSeats,
        availableSeats,
        soldSeats: Math.max(totalSeats - availableSeats, 0),
        unknownSeats: 0,
        rows: []
      };
    });
  }

  return areas.map((area) => {
    const seats = (area.objRow || []).flatMap((row) => row.objSeat || []);
    const totalSeats = seats.length;
    const availableSeats = seats.filter((seat) =>
      AVAILABLE_SEAT_STATUSES.has(toNumber(seat.SeatStatus))
    ).length;

    return {
      name: area.AreaDesc || area.label || "Category",
      label: area.AreaDesc || area.label || "Category",
      price: priceForArea(session, area),
      totalSeats,
      availableSeats,
      soldSeats: Math.max(totalSeats - availableSeats, 0),
      unknownSeats: 0,
      rows: []
    };
  });
}

function applySaiChitraBlockedSeats(categories) {
  let remainingBlockedSeats = SAI_CHITRA_DEFAULT_BLOCKED_SEATS_PER_SHOW;
  const preferredOrder = categories
    .map((category, index) => ({ category, index }))
    .sort((left, right) => {
      const leftReserved = /reserved/i.test(left.category.label || left.category.name || "");
      const rightReserved = /reserved/i.test(right.category.label || right.category.name || "");
      if (leftReserved !== rightReserved) return leftReserved ? -1 : 1;
      return Number(right.category.soldSeats || 0) - Number(left.category.soldSeats || 0);
    })
    .map((entry) => entry.index);
  const blockedByIndex = new Map();

  for (const index of preferredOrder) {
    const category = categories[index];
    const rawSoldSeats = Number(category.soldSeats || 0);
    const blockedSeats = Math.min(rawSoldSeats, remainingBlockedSeats);
    blockedByIndex.set(index, blockedSeats);
    remainingBlockedSeats -= blockedSeats;
    if (remainingBlockedSeats <= 0) break;
  }

  return categories.map((category, index) => {
    const rawSoldSeats = Number(category.soldSeats || 0);
    const blockedSeats = Number(blockedByIndex.get(index) || 0);
    const price = toNumber(category.price);
    const netPrice = netTicketPrice(price);

    return {
      ...category,
      rawSoldSeats,
      blockedSeats,
      blockedGross: blockedSeats * netPrice,
      soldSeats: Math.max(rawSoldSeats - blockedSeats, 0),
      netPrice
    };
  });
}

function buildShowFromCategories({ session, movie, categories, theatrePageUrl }) {
  const dateInfo = indiaDateInfoFromSession(session);
  const normalizedCategories = applySaiChitraBlockedSeats(categories);
  const totalSeats = normalizedCategories.reduce((sum, category) => sum + category.totalSeats, 0);
  const availableSeats = normalizedCategories.reduce((sum, category) => sum + category.availableSeats, 0);
  const soldSeats = normalizedCategories.reduce((sum, category) => sum + category.soldSeats, 0);
  const blockedSeats = normalizedCategories.reduce((sum, category) => sum + category.blockedSeats, 0);
  const rawUnavailableSeats = normalizedCategories.reduce((sum, category) => sum + category.rawSoldSeats, 0);
  const gross = normalizedCategories.reduce(
    (sum, category) => sum + category.soldSeats * netTicketPrice(category.price),
    0
  );
  const blockedGross = normalizedCategories.reduce((sum, category) => sum + category.blockedGross, 0);
  const contentId = movie?.contentId || session.contentId || session.mid || "unknown";
  const formatId = String(session.fid || "").toLowerCase();
  const encSessionId =
    session.encSessionId ||
    `${SAI_CHITRA_THEATRE.cinemaId}-${session.sid}-${String(session.mid || "").toLowerCase()}-${formatId}`;

  return {
    id: `${SAI_CHITRA_THEATRE.venueCode}-${session.sid}`,
    eventCode: `TN${contentId}`,
    sessionId: session.sid,
    platform: "ticketnew",
    venueCode: SAI_CHITRA_THEATRE.venueCode,
    venueName: SAI_CHITRA_THEATRE.name,
    theatreShortName: SAI_CHITRA_THEATRE.shortName,
    citySlug: "madanapalle",
    ...dateInfo,
    cutoffAt: "",
    cutoffCode: "",
    format: movie?.format || session.scrnFmt || "2D",
    language: movie?.language || session.lang || "Telugu",
    title: movie?.title || "Untitled Movie",
    releaseLabel: movie?.title || "Untitled Movie",
    censor: movie?.censor || "",
    genres: movie?.genres || session.gnrs || [],
    trailerUrl: "",
    screenName: session.audi || SAI_CHITRA_THEATRE.shortName,
    bookingUrl: theatrePageUrl,
    seatLayoutUrl: `https://ticketnew.com/movies/seat-layout/${formatId}?encsessionid=${encodeURIComponent(
      encSessionId
    )}&freeseating=false&fromsessions=true&type=CINEMAS&contentid=${contentId}`,
    categories: normalizedCategories,
    totalSeats,
    availableSeats,
    soldSeats,
    blockedSeats,
    blockedGross,
    rawUnavailableSeats,
    unknownSeats: 0,
    gross,
    occupancyPercent: totalSeats ? Number(((soldSeats / totalSeats) * 100).toFixed(2)) : 0,
    notes: [
      `${SAI_CHITRA_DEFAULT_BLOCKED_SEATS_PER_SHOW} default Sai Chitra blocked seats are excluded from sold tickets and gross.`
    ],
    source: {
      method: "ticketnew-seat-layout",
      platform: "ticketnew",
      sourceUrl: theatrePageUrl,
      capturedAt: new Date().toISOString()
    }
  };
}

export async function fetchSaiChitraTicketNewShows({ date, fetchImpl = fetch }) {
  const theatrePage = await fetchTheatrePage({ date, fetchImpl });
  const nextData = extractNextData(theatrePage.html);
  const cinemaSessions = findCinemaSessions(nextData, date);
  const movieBySessionId = buildSessionMovieMap(cinemaSessions);
  const fallbackMovie = fallbackMovieFromArrangedSessions(cinemaSessions);
  const sessions = (cinemaSessions?.pageData?.sessions || []).filter((session) => {
    const info = indiaDateInfoFromSession(session);
    return info.showDate === date;
  });

  const shows = await Promise.all(
    sessions.map(async (session) => {
      const movie =
        movieBySessionId.get(session.sid) ||
        fallbackMovie || {
          contentId: session.contentId || session.mid,
          title: "Untitled Movie",
          language: session.lang,
          format: session.scrnFmt,
          genres: session.gnrs || []
        };
      const seatMap = await fetchSeatMap({ session, movie, fetchImpl });
      const categories = categoriesFromSeatMap(session, seatMap);
      return buildShowFromCategories({
        session,
        movie,
        categories,
        theatrePageUrl: theatrePage.url
      });
    })
  );
  const showsBySessionId = new Map();
  for (const show of shows) {
    const existing = showsBySessionId.get(show.sessionId);
    if (!existing || existing.title === "Untitled Movie") {
      showsBySessionId.set(show.sessionId, show);
    }
  }

  return {
    theatre: SAI_CHITRA_THEATRE,
    dates: cinemaSessions?.data?.sessionDates || [],
    shows: [...showsBySessionId.values()].sort((left, right) =>
      left.showDateTime.localeCompare(right.showDateTime)
    ),
    meta: {
      platform: "ticketnew",
      source: "ticketnew-theatre-page",
      sourceUrl: theatrePage.url,
      districtUrl: DISTRICT_BASE_URL,
      capturedAt: new Date().toISOString()
    }
  };
}
