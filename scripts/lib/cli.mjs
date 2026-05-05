export function parseArgs(argv) {
  const args = {
    sample: false,
    today: false,
    tomorrow: false,
    date: null,
    theatre: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--sample") args.sample = true;
    else if (value === "--today") args.today = true;
    else if (value === "--tomorrow") args.tomorrow = true;
    else if (value === "--date") args.date = argv[index + 1];
    else if (value.startsWith("--date=")) args.date = value.split("=")[1];
    else if (value === "--theatre") args.theatre = argv[index + 1];
    else if (value.startsWith("--theatre=")) args.theatre = value.split("=")[1];
  }

  return args;
}
