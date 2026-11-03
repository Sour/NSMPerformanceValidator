import { describe, expect, it } from "vitest";
import { createGarminClient, GarminError } from "./garmin";

const TOKEN_URL = "https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token";
const ZONES_URL = "https://personal.connectapi.garmin.com/biometric-service/heartRateZones/v2";

const zones = [
  { sport: "DEFAULT", lactateThresholdHeartRateUsed: 170, maxHeartRateUsed: 190 },
  { sport: "RUNNING", lactateThresholdHeartRateUsed: 173, maxHeartRateUsed: 194 },
  { sport: "CYCLING", lactateThresholdHeartRateUsed: 160, maxHeartRateUsed: 185 },
];

interface Call {
  url: string;
  method: string;
  authorization: string | null;
}

/** Answers the token and zones requests with the given responses, or throws a network error, recording each call. */
function fakeFetch(token: () => Response, zonesResponse: () => Response) {
  const calls: Call[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", authorization: new Headers(init?.headers).get("authorization") });
    if (url === TOKEN_URL) return token();
    if (url === ZONES_URL) return zonesResponse();
    throw new Error(`Unexpected request to ${url}`);
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const ok = (body: unknown) => () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });
const status = (code: number) => () => new Response("nope", { status: code });
const offline = () => {
  throw new TypeError("fetch failed");
};

async function failure(promise: Promise<unknown>): Promise<GarminError> {
  const e = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(e).toBeInstanceOf(GarminError);
  return e as GarminError;
}

describe("Garmin client", () => {
  it("mints a token from the key and reads the running LTHR and Max HR, ignoring other sports", async () => {
    const { fetch, calls } = fakeFetch(ok("jwt-token"), ok(zones));
    const garmin = createGarminClient("the-key", fetch);

    expect(await garmin.runningThresholds()).toEqual({ lthr: 173, maxHr: 194 });
    expect(calls).toEqual([
      { url: TOKEN_URL, method: "POST", authorization: "ApiKey the-key" },
      { url: ZONES_URL, method: "GET", authorization: "Bearer jwt-token" },
    ]);
  });

  it("reuses the token while it is fresh, and mints a new one once it is a day old", async () => {
    let now = new Date("2026-11-02T08:00:00Z").getTime();
    const { fetch, calls } = fakeFetch(ok("jwt-token"), ok(zones));
    const garmin = createGarminClient("the-key", fetch, () => now);

    await garmin.runningThresholds();
    now += 30 * 60_000;
    await garmin.runningThresholds();
    expect(calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(1);

    now += 24 * 3_600_000;
    await garmin.runningThresholds();
    expect(calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(2);
  });

  it("mints a new token when Garmin rejects the one it had", async () => {
    let zonesCalls = 0;
    const { fetch, calls } = fakeFetch(ok("jwt-token"), () => (++zonesCalls === 2 ? status(401)() : ok(zones)()));
    const garmin = createGarminClient("the-key", fetch);

    await garmin.runningThresholds();
    expect(await garmin.runningThresholds()).toEqual({ lthr: 173, maxHr: 194 });
    expect(calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(2);
  });

  it("fails as KeyRejected when Garmin refuses the key, as when it has expired", async () => {
    for (const code of [401, 403]) {
      const { fetch } = fakeFetch(status(code), ok(zones));
      expect((await failure(createGarminClient("old-key", fetch).runningThresholds())).kind).toBe("KeyRejected");
    }
  });

  it("fails as Unreachable when Garmin cannot be reached", async () => {
    const { fetch } = fakeFetch(offline, ok(zones));
    expect((await failure(createGarminClient("the-key", fetch).runningThresholds())).kind).toBe("Unreachable");
  });

  it("fails as Unexpected on an error status, a response without a RUNNING entry, or without its thresholds", async () => {
    const cases = [
      fakeFetch(status(500), ok(zones)),
      fakeFetch(ok("jwt-token"), status(500)),
      fakeFetch(ok("jwt-token"), ok("not json")),
      fakeFetch(ok("jwt-token"), ok([zones[0]])),
      fakeFetch(ok("jwt-token"), ok([{ sport: "RUNNING", lactateThresholdHeartRateUsed: null, maxHeartRateUsed: 194 }])),
    ];
    for (const { fetch } of cases) {
      expect((await failure(createGarminClient("the-key", fetch).runningThresholds())).kind).toBe("Unexpected");
    }
  });
});
