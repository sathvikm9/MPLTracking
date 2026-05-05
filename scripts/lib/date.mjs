const INDIA_TIMEZONE = "Asia/Kolkata";

export function getIndiaDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: INDIA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return {
    year,
    month,
    day,
    isoDate: `${year}-${month}-${day}`,
    dateCode: `${year}${month}${day}`
  };
}

export function resolveTargetDate(argv) {
  const today = getIndiaDateParts();

  if (argv.sample) {
    return today;
  }

  if (argv.date) {
    const cleaned = String(argv.date).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
      throw new Error(`Invalid --date value: ${cleaned}`);
    }

    return {
      isoDate: cleaned,
      dateCode: cleaned.replaceAll("-", "")
    };
  }

  if (argv.today) {
    return today;
  }

  if (argv.tomorrow) {
    const base = new Date();
    base.setUTCDate(base.getUTCDate() + 1);
    return getIndiaDateParts(base);
  }

  return today;
}

export function toIsoFromDateCode(dateCode) {
  const code = String(dateCode);
  return `${code.slice(0, 4)}-${code.slice(4, 6)}-${code.slice(6, 8)}`;
}

export function formatGeneratedAt(date = new Date()) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: INDIA_TIMEZONE,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

export function inferCutoffIso(showDateTime, liveCutoffCode, fallbackMinutes) {
  if (liveCutoffCode) {
    return dateCodeToIsoTimestamp(liveCutoffCode);
  }

  const showIso = dateCodeToIsoTimestamp(showDateTime);
  const date = new Date(showIso);
  date.setMinutes(date.getMinutes() + fallbackMinutes);
  return date.toISOString();
}

export function dateCodeToIsoTimestamp(dateCodeWithTime) {
  const value = String(dateCodeWithTime);
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6)) - 1;
  const day = Number(value.slice(6, 8));
  const hours = Number(value.slice(8, 10));
  const minutes = Number(value.slice(10, 12));

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: INDIA_TIMEZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  const utcGuess = new Date(Date.UTC(year, month, day, hours, minutes, 0));
  const formatted = formatter.formatToParts(utcGuess);
  const asMap = Object.fromEntries(
    formatted
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  const guessedLocal =
    Number(asMap.year) * 100000000 +
    Number(asMap.month) * 1000000 +
    Number(asMap.day) * 10000 +
    Number(asMap.hour) * 100 +
    Number(asMap.minute);

  const targetLocal =
    year * 100000000 + (month + 1) * 1000000 + day * 10000 + hours * 100 + minutes;

  const offsetMinutes = guessedLocal === targetLocal ? 0 : 330;
  const utcDate = new Date(Date.UTC(year, month, day, hours, minutes - offsetMinutes, 0));
  return utcDate.toISOString();
}
