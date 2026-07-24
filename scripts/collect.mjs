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
    if (existing.targetDate !== data.targetDate) {
      return {
        ...data,
        meta: {
          ...(data.meta || {}),
          notes: [
            ...((data.meta && data.meta.notes) || []),
            `The last non-empty snapshot is for ${existing.targetDate}; it was not reused for ${data.targetDate}.`
          ]
        }
      };
    }

    return {
      ...existing,
      generatedAt: data.generatedAt,
      generatedAtLabel: data.generatedAtLabel,
      meta: {
        ...(existing.meta || {}),
        status: "stale",
        notes: [
          `Scheduled collector found 0 shows for ${data.targetDate}; preserved the previous snapshot for the same date.`,
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
