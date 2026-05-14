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
            "Returns available booking dates for all active Madanapalle theatres or one selected theatre. This is the endpoint the date strip should use.",
          parameters: [
            {
              name: "venueCode",
              in: "query",
              required: false,
              description:
                "Optional theatre code. Leave empty for all theatres. Active values: RTDM Ravi, ASRM ASR, MSDR Siddartha, SKMD Sri Krishna.",
              schema: {
                type: "string",
                enum: ["RTDM", "ASRM", "MSDR", "SKMD"]
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
            "Returns only shows visible for the selected date/theatre according to the live proxy path. Gross uses net ticket price: 105 -> 100 and 84 -> 79.",
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
                "Optional theatre code. Leave empty for all theatres. Active values: RTDM Ravi, ASRM ASR, MSDR Siddartha, SKMD Sri Krishna.",
              schema: {
                type: "string",
                enum: ["RTDM", "ASRM", "MSDR", "SKMD"]
              },
              example: "RTDM"
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
                enum: ["RTDM", "ASRM", "MSDR", "SKMD"]
              },
              example: "RTDM"
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
