/** The LTHR and Max HR of the runner's Garmin running profile, in bpm: what the watch detects (ADR 0007). */
export interface RunningThresholds {
  lthr: number;
  maxHr: number;
}

/** Access to the runner's Garmin Connect account through the Personal API; read only. */
export interface GarminClient {
  /** The LTHR and Max HR of the runner's Garmin running profile; rejects with a GarminError when they cannot be read. */
  runningThresholds(): Promise<RunningThresholds>;
}

/**
 * Why Garmin could not be read: the key was refused (as once it has expired), Garmin could not be reached, or it gave
 * a response we cannot read, such as one without a running profile.
 */
export type GarminFailure = "KeyRejected" | "Unreachable" | "Unexpected";

/** Garmin could not be read, and why. */
export class GarminError extends Error {
  constructor(
    readonly kind: GarminFailure,
    message: string,
  ) {
    super(message);
    this.name = "GarminError";
  }
}

const BASE_URL = "https://personal.connectapi.garmin.com";
const TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token";
const ZONES_PATH = "/biometric-service/heartRateZones/v2";
/** How long a minted token is used for; Garmin's last 24 hours, so this leaves a margin. */
const TOKEN_LIFETIME_MS = 23 * 3_600_000;
/** How much of an error response to keep in the message. */
const ERROR_BODY_CHARS = 200;

/**
 * A Garmin client for one Personal API key. It mints an access token from the key when it has none less than a day
 * old, or when Garmin refuses the one it has; there are no refresh tokens. Every failure is a GarminError.
 */
export function createGarminClient(apiKey: string, fetchFn: typeof fetch = fetch, now = () => Date.now()): GarminClient {
  let token: { value: string; mintedAt: number } | null = null;

  async function request(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchFn(`${BASE_URL}${path}`, init);
    } catch (e) {
      throw new GarminError("Unreachable", `Garmin ${path} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function failed(path: string, res: Response): Promise<GarminError> {
    const kind = res.status === 401 || res.status === 403 ? "KeyRejected" : "Unexpected";
    return new GarminError(kind, `Garmin ${path} failed: ${res.status} ${(await res.text()).slice(0, ERROR_BODY_CHARS)}`);
  }

  async function mint(): Promise<string> {
    const res = await request(TOKEN_PATH, { method: "POST", headers: { authorization: `ApiKey ${apiKey}` } });
    if (!res.ok) throw await failed(TOKEN_PATH, res);
    // The body is the bare token, not JSON.
    const value = (await res.text()).trim();
    if (value === "") throw new GarminError("Unexpected", `Garmin ${TOKEN_PATH} gave no token`);
    token = { value, mintedAt: now() };
    return value;
  }

  async function zones(): Promise<unknown> {
    const fresh = token !== null && now() - token.mintedAt < TOKEN_LIFETIME_MS;
    const get = async (value: string) =>
      request(ZONES_PATH, { headers: { authorization: `Bearer ${value}`, accept: "application/json" } });
    let res = await get(fresh ? token!.value : await mint());
    if (fresh && (res.status === 401 || res.status === 403)) res = await get(await mint());
    if (!res.ok) throw await failed(ZONES_PATH, res);
    try {
      return await res.json();
    } catch {
      throw new GarminError("Unexpected", `Garmin ${ZONES_PATH} did not answer with JSON`);
    }
  }

  return {
    async runningThresholds() {
      const thresholds = runningThresholds(await zones());
      if (thresholds === null) throw new GarminError("Unexpected", `Garmin ${ZONES_PATH} has no running LTHR and Max HR`);
      return thresholds;
    },
  };
}

/**
 * The running LTHR and Max HR in a `heartRateZones/v2` response: its `RUNNING` entry's, the only one using the watch's
 * lactate-threshold detection. Null when it has none, or either is missing.
 */
function runningThresholds(response: unknown): RunningThresholds | null {
  const entries = Array.isArray(response) ? (response as Record<string, unknown>[]) : [];
  const running = entries.find((e) => e?.sport === "RUNNING");
  const lthr = running?.lactateThresholdHeartRateUsed;
  const maxHr = running?.maxHeartRateUsed;
  return typeof lthr === "number" && lthr > 0 && typeof maxHr === "number" && maxHr > 0 ? { lthr, maxHr } : null;
}
