function applyCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Cache-Control", "no-store");
}

function buildOpenApiSpec(req) {
  const host = req.headers.host || "proxy-vercel-green.vercel.app";
  const protocol = host.includes("localhost") ? "http" : "https";
  const serverUrl = `${protocol}://${host}`;

  return {
    openapi: "3.0.3",
    info: {
      title: "MPLTracking Madanapalle Live API",
      version: "1.0.0",
      description:
        "Live Madanapalle BookMyShow tracking proxy. Use theatre/date endpoints to debug available dates, visible shows, sold tickets, and gross using net ticket prices."
    },
    servers: [
      {
        url: serverUrl,
        description: "Current Vercel proxy"
      },
      {
        url: "https://proxy-vercel-green.vercel.app",
        description: "Production alias"
      }
    ],
    tags: [
      {
        name: "Live tracking",
        description: "Theatre/date discovery and live sold-ticket snapshots"
      },
      {
        name: "Mirror debug",
        description: "Raw BookMyShow mirror payload checks by event code"
      },
      {
        name: "Boxoffice",
        description: "Stored boxoffice snapshots and scheduled cutoff collection"
      },
      {
        name: "Health",
        description: "Proxy health checks"
      }
    ],
    paths: {
      "/api/health": {
        get: {
          tags: ["Health"],
          summary: "Check proxy health",
          responses: {
            200: {
              description: "Proxy is running"
            }
          }
        }
      },
      "/api/live-dates": {
        get: {
          tags: ["Live tracking"],
          summary: "Get available booking dates",
          description:
            "Optional helper for available booking dates. The current website uses a normal calendar and calls /api/live directly for the selected theatre/date.",
          parameters: [
            {
              name: "venueCode",
              in: "query",
              required: false,
              description:
                "Optional theatre code. Leave empty for all theatres. Active values: RTDM Ravi, ASRM ASR, MSDR Siddartha, SKMD Sri Krishna, SAIC Sai Chitra.",
              schema: {
                type: "string",
                enum: ["RTDM", "ASRM", "MSDR", "SKMD", "SAIC"]
              },
              example: "RTDM"
            },
            {
              name: "days",
              in: "query",
              required: false,
              description: "Number of India dates to scan from today. Max 21.",
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 21,
                default: 9
              },
              example: 9
            },
            {
              name: "_",
              in: "query",
              required: false,
              description: "Cache-buster timestamp for manual refresh testing.",
              schema: {
                type: "string"
              },
              example: "1778770000000"
            }
          ],
          responses: {
            200: {
              description: "Available dates and show counts",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/LiveDatesResponse"
                  }
                }
              }
            }
          }
        }
      },
      "/api/live": {
        get: {
          tags: ["Live tracking"],
          summary: "Get live sold-ticket snapshot for a date",
          description:
            "Returns shows and live sold-ticket counts for the selected date/theatre. Gross uses each live category ticket price minus 5 rupees. Use liveOnly=1 to block static snapshot fallback while still allowing theatre-page to live-mirror retry.",
          parameters: [
            {
              name: "date",
              in: "query",
              required: true,
              description: "Selected date in YYYY-MM-DD format.",
              schema: {
                type: "string",
                format: "date"
              },
              example: "2026-05-15"
            },
            {
              name: "venueCode",
              in: "query",
              required: false,
              description:
                "Optional theatre code. Leave empty for all theatres. Active values: RTDM Ravi, ASRM ASR, MSDR Siddartha, SKMD Sri Krishna, SAIC Sai Chitra.",
              schema: {
                type: "string",
                enum: ["RTDM", "ASRM", "MSDR", "SKMD", "SAIC"]
              },
              example: "RTDM"
            },
            {
              name: "liveOnly",
              in: "query",
              required: false,
              description:
                "Set to 1 for Live Tracking. This tries BookMyShow theatre-page first, then the live Madanapalle mirror/catalog path, with no static snapshot fallback.",
              schema: {
                type: "string",
                enum: ["1"]
              },
              example: "1"
            },
            {
              name: "mirrorOnly",
              in: "query",
              required: false,
              description:
                "Set to 1 to skip theatre-page discovery and retry directly through the live Madanapalle mirror/catalog path.",
              schema: {
                type: "string",
                enum: ["1"]
              },
              example: "1"
            },
            {
              name: "mirrorRetryRounds",
              in: "query",
              required: false,
              description: "Number of live mirror retry rounds. Values are clamped between 1 and 6.",
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 6
              },
              example: 6
            },
            {
              name: "_",
              in: "query",
              required: false,
              description: "Cache-buster timestamp for manual refresh testing.",
              schema: {
                type: "string"
              },
              example: "1778770000000"
            }
          ],
          responses: {
            200: {
              description: "Live snapshot with shows, sold tickets, categories, and gross",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/LiveSnapshot"
                  }
                }
              }
            }
          }
        }
      },
      "/api/madanapalle-showtimes": {
        get: {
          tags: ["Mirror debug"],
          summary: "Debug raw movie-event showtimes mirror",
          description:
            "Direct mirror/debug endpoint. Use this like BoxOffice24: eventCode + date/dateCode + optional venueCode. If this returns mirror 500 or empty payload, live counts cannot be calculated for that selection.",
          parameters: [
            {
              name: "eventCode",
              in: "query",
              required: true,
              description: "BookMyShow event code, for example ET00455003.",
              schema: {
                type: "string",
                pattern: "^ET\\d+$"
              },
              example: "ET00455003"
            },
            {
              name: "date",
              in: "query",
              required: false,
              description: "Date in YYYY-MM-DD format. Use either date or dateCode.",
              schema: {
                type: "string",
                format: "date"
              },
              example: "2026-05-15"
            },
            {
              name: "dateCode",
              in: "query",
              required: false,
              description: "Date code in YYYYMMDD format. Use either date or dateCode.",
              schema: {
                type: "string",
                pattern: "^\\d{8}$"
              },
              example: "20260515"
            },
            {
              name: "venueCode",
              in: "query",
              required: false,
              description: "Optional theatre filter.",
              schema: {
                type: "string",
                enum: ["RTDM", "ASRM", "MSDR", "SKMD", "SAIC"]
              },
              example: "RTDM"
            },
            {
              name: "strict",
              in: "query",
              required: false,
              description:
                "Set to 1 to disable the proxy last-good cache and fail if every live mirror fails.",
              schema: {
                type: "string",
                enum: ["1"]
              },
              example: "1"
            },
            {
              name: "_",
              in: "query",
              required: false,
              description: "Cache-buster timestamp for manual refresh testing.",
              schema: {
                type: "string"
              }
            }
          ],
          responses: {
            200: {
              description: "Raw mirror payload plus summary/attempt metadata",
              content: {
                "application/json": {
                  schema: {
                    type: "object"
                  }
                }
              }
            },
            500: {
              description: "Mirror/proxy failure"
            }
          }
        }
      },
      "/api/boxoffice": {
        get: {
          tags: ["Boxoffice"],
          summary: "Read stored live boxoffice snapshot",
          description: "Reads the selected date's captured boxoffice result from Upstash Redis.",
          parameters: [
            {
              name: "date",
              in: "query",
              required: true,
              description: "Boxoffice date in YYYY-MM-DD format.",
              schema: {
                type: "string",
                format: "date"
              },
              example: "2026-05-15"
            }
          ],
          responses: {
            200: {
              description: "Stored boxoffice snapshot"
            },
            404: {
              description: "No boxoffice data for selected date"
            }
          }
        }
      },
      "/api/boxoffice-collect": {
        get: {
          tags: ["Boxoffice"],
          summary: "Run live boxoffice collector",
          description:
            "Fetches fresh live data for Madanapalle theatres, captures shows whose cutoff capture time is due, and writes directly to Upstash Redis. Intended for a minute-level scheduler such as Upstash QStash.",
          parameters: [
            {
              name: "date",
              in: "query",
              required: false,
              description: "Optional boxoffice date in YYYY-MM-DD format. Defaults to current India date.",
              schema: {
                type: "string",
                format: "date"
              },
              example: "2026-05-15"
            },
            {
              name: "token",
              in: "query",
              required: false,
              description:
                "Optional collector token when BOXOFFICE_COLLECT_TOKEN or CRON_SECRET is configured.",
              schema: {
                type: "string"
              }
            }
          ],
          responses: {
            200: {
              description: "Collector run summary"
            }
          }
        }
      }
    },
    components: {
      schemas: {
        LiveDatesResponse: {
          type: "object",
          properties: {
            liveDiscovery: { type: "boolean" },
            source: { type: "string" },
            venueCode: { type: "string" },
            generatedAt: { type: "string", format: "date-time" },
            dates: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  date: { type: "string", format: "date" },
                  dateCode: { type: "string" },
                  totalShows: { type: "integer" },
                  theatres: { type: "array", items: { type: "object" } },
                  theatreCounts: { type: "object" },
                  movies: { type: "array", items: { type: "object" } }
                }
              }
            },
            meta: { type: "object" }
          }
        },
        LiveSnapshot: {
          type: "object",
          properties: {
            version: { type: "integer" },
            generatedAt: { type: "string", format: "date-time" },
            targetDate: { type: "string", format: "date" },
            summary: {
              type: "object",
              properties: {
                totalShows: { type: "integer" },
                totalCapacity: { type: "integer" },
                totalAvailable: { type: "integer" },
                totalSold: { type: "integer" },
                totalGross: { type: "integer" },
                occupancyPercent: { type: "number" }
              }
            },
            shows: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  eventCode: { type: "string" },
                  venueCode: { type: "string" },
                  theatreShortName: { type: "string" },
                  title: { type: "string" },
                  showTimeLabel: { type: "string" },
                  totalSeats: { type: "integer" },
                  availableSeats: { type: "integer" },
                  soldSeats: { type: "integer" },
                  gross: { type: "integer" },
                  categories: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        label: { type: "string" },
                        price: { type: "number" },
                        netPrice: { type: "number" },
                        totalSeats: { type: "integer" },
                        availableSeats: { type: "integer" },
                        soldSeats: { type: "integer" },
                        gross: { type: "integer" }
                      }
                    }
                  }
                }
              }
            },
            meta: { type: "object" }
          }
        }
      }
    }
  };
}

export default async function handler(req, res) {
  applyCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  res.status(200).json(buildOpenApiSpec(req));
}
