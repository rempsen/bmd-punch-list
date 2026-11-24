/**
 * Weather for a daily log, from Open-Meteo (free, no key). Everything here takes `fetch` as an argument so it can be
 * tested with canned answers. Nothing throws and nothing is ever guessed: when the place or the weather cannot be
 * found the log is stored as "unavailable".
 */
import { SCHEDULE_TZ } from "@/lib/visits/logic";

export type JobPlace = { city: string | null; province: string | null; address: string | null };
export type Located = { latitude: number; longitude: number; place: string | null };
export type DayWeather = { code: number; conditions: string; tempNowC: number | null; highC: number; lowC: number };

const PROVINCES: Record<string, string> = {
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland and Labrador", NS: "Nova Scotia", NT: "Northwest Territories",
  NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island", QC: "Quebec", SK: "Saskatchewan", YT: "Yukon",
};
const provinceName = (p: string | null | undefined): string | null => {
  const t = (p ?? "").trim();
  if (!t) return null;
  return PROVINCES[t.toUpperCase()] ?? Object.values(PROVINCES).find((n) => n.toLowerCase() === t.toLowerCase()) ?? null;
};

/** Place names to look up, most likely first. The service knows towns and cities, not street addresses. */
export function placeCandidates(job: JobPlace): string[] {
  const out: string[] = [];
  const add = (s: string | null | undefined) => {
    const t = (s ?? "").trim();
    if (!t || /\d/.test(t) || provinceName(t) || /^canada$/i.test(t)) return;
    if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  add(job.city);
  for (const part of (job.address ?? "").split(",")) add(part);
  return out;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

async function getJson(fetchFn: typeof fetch, url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetchFn(url);
    if (!res.ok) return null;
    const body = (await res.json()) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Latitude and longitude for the job's town. When the job names a province, only a match in that province counts. */
export async function geocodePlace(fetchFn: typeof fetch, job: JobPlace): Promise<Located | null> {
  const province = provinceName(job.province) ?? (job.address ?? "").split(/[,\s]+/).map(provinceName).find(Boolean) ?? null;
  for (const name of placeCandidates(job)) {
    const body = await getJson(fetchFn, `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=en&format=json`);
    const results = (Array.isArray(body?.["results"]) ? body!["results"] : []) as Record<string, unknown>[];
    const good = results.filter((r) => num(r["latitude"]) != null && num(r["longitude"]) != null);
    const pick = province
      ? good.find((r) => String(r["admin1"] ?? "").toLowerCase() === province.toLowerCase())
      : (good.find((r) => r["country_code"] === "CA") ?? good[0]);
    if (pick) return { latitude: pick["latitude"] as number, longitude: pick["longitude"] as number, place: [pick["name"], pick["admin1"]].filter((x) => typeof x === "string" && x).join(", ") || null };
  }
  return null;
}

const CONDITIONS: Record<number, string> = {
  0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Freezing fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Light showers", 81: "Showers", 82: "Heavy showers", 85: "Snow showers", 86: "Heavy snow showers",
  95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with hail",
};
/** Plain words for a WMO weather code, or null for a code we do not know. */
export const conditionsFor = (code: number): string | null => CONDITIONS[code] ?? null;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** The address to ask for one day's weather: the forecast service for the last two months, the archive before that. */
export function weatherUrl(q: { latitude: number; longitude: number; date: string; today: string; timeZone?: string }): string | null {
  if (!DAY.test(q.date) || !DAY.test(q.today)) return null;
  const age = daysBetween(q.date, q.today);
  if (!Number.isFinite(age) || age < 0) return null;
  const base = age <= 60 ? "https://api.open-meteo.com/v1/forecast" : "https://archive-api.open-meteo.com/v1/archive";
  return (
    `${base}?latitude=${q.latitude}&longitude=${q.longitude}&start_date=${q.date}&end_date=${q.date}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min${age === 0 ? "&current=temperature_2m,weather_code" : ""}` +
    `&timezone=${encodeURIComponent(q.timeZone ?? SCHEDULE_TZ)}`
  );
}

/** Conditions, high and low for the day (and the temperature now, for today). Null unless every value is really there. */
export async function fetchDayWeather(fetchFn: typeof fetch, q: { latitude: number; longitude: number; date: string; today: string; timeZone?: string }): Promise<DayWeather | null> {
  const url = weatherUrl(q);
  if (!url) return null;
  const body = await getJson(fetchFn, url);
  const daily = body?.["daily"] as Record<string, unknown[]> | undefined;
  if (!daily || !Array.isArray(daily["time"])) return null;
  const i = daily["time"].indexOf(q.date);
  if (i < 0) return null;
  const code = num(daily["weather_code"]?.[i]);
  const highC = num(daily["temperature_2m_max"]?.[i]);
  const lowC = num(daily["temperature_2m_min"]?.[i]);
  const conditions = code == null ? null : conditionsFor(code);
  if (code == null || conditions == null || highC == null || lowC == null) return null;
  const current = body?.["current"] as Record<string, unknown> | undefined;
  return { code, conditions, tempNowC: q.date === q.today ? num(current?.["temperature_2m"]) : null, highC, lowC };
}

export type WeatherPatch = {
  weather_status: "ok" | "unavailable";
  weather_conditions: string | null;
  weather_code: number | null;
  temp_now_c: number | null;
  temp_high_c: number | null;
  temp_low_c: number | null;
  weather_place: string | null;
  latitude: number | null;
  longitude: number | null;
  weather_fetched_at: string;
};

/** What to store on a log. Reuses a location cached on an earlier log of the job; otherwise looks the job's town up. */
export async function weatherForLog(fetchFn: typeof fetch, input: { job: JobPlace; date: string; today: string; cached: Located | null; now: string; timeZone?: string }): Promise<WeatherPatch> {
  const none: WeatherPatch = {
    weather_status: "unavailable", weather_conditions: null, weather_code: null, temp_now_c: null, temp_high_c: null, temp_low_c: null,
    weather_place: null, latitude: null, longitude: null, weather_fetched_at: input.now,
  };
  try {
    const at = input.cached ?? (await geocodePlace(fetchFn, input.job));
    if (!at) return none;
    const where = { weather_place: at.place, latitude: at.latitude, longitude: at.longitude };
    const w = await fetchDayWeather(fetchFn, { latitude: at.latitude, longitude: at.longitude, date: input.date, today: input.today, ...(input.timeZone ? { timeZone: input.timeZone } : {}) });
    if (!w) return { ...none, ...where };
    return { ...none, ...where, weather_status: "ok", weather_conditions: w.conditions, weather_code: w.code, temp_now_c: w.tempNowC, temp_high_c: w.highC, temp_low_c: w.lowC };
  } catch {
    return none;
  }
}
