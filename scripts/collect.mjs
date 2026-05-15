import fs from "node:fs/promises";

import { collectLiveData, collectSampleData, writeOutput } from "./lib/bookmyshow.mjs";
import { parseArgs } from "./lib/cli.mjs";
import { resolveTargetDate } from "./lib/date.mjs";

const STATIC_LATEST_PATH = "./public/data/latest.json";

async function preserveLastNonEmptySnapshot(data) {
  if (Number(data?.summary?.totalShows || 0) > 0) return data;

  try {
    const existing = JSON.parse(await fs.readFile(STATIC_LATEST_PATH, "utf8"));
    if (Number(existing?.summary?.totalShows || 0) <= 0) return data;

    return {
      ...existing,
      meta: {
        ...(existing.meta || {}),
        notes: [
          `Scheduled collector found 0 shows for ${data.targetDate}; preserved the last non-empty static snapshot so Pages can still publish boxoffice captures.`,
          ...((existing.meta && existing.meta.notes) || [])
        ]
      }
    };
  } catch {
    return data;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetDate = resolveTargetDate(args);

  let data = args.sample
    ? await collectSampleData(targetDate)
    : await collectLiveData(targetDate, {
        theatre: args.theatre || null
      });

  if (!args.sample) {
    data = await preserveLastNonEmptySnapshot(data);
  }

  await writeOutput(data);

  console.log(
    JSON.stringify(
      {
        generatedAt: data.generatedAt,
        targetDate: data.targetDate,
        totalShows: data.summary.totalShows,
        totalSold: data.summary.totalSold,
        totalCapacity: data.summary.totalCapacity,
        notes: data.meta.notes
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
