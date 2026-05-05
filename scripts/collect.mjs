import { collectLiveData, collectSampleData, writeOutput } from "./lib/bookmyshow.mjs";
import { parseArgs } from "./lib/cli.mjs";
import { resolveTargetDate } from "./lib/date.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetDate = resolveTargetDate(args);

  const data = args.sample
    ? await collectSampleData(targetDate)
    : await collectLiveData(targetDate, {
        theatre: args.theatre || null
      });

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
