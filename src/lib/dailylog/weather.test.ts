import { describe, expect, test } from "bun:test";
import { conditionsFor, fetchDayWeather, geocodePlace, placeCandidates, weatherForLog, weatherUrl } from "./weather";

type Canned = Record<string, unknown | Error | { status: number }>;
/** A stand-in for fetch: answers by the first key the URL contains, and records every URL asked for. */
function canned(map: Canned) {
  const calls: string[] = [];
  const f = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const key = Object.keys(map).find((k) => url.includes(k));
    const v = key ? map[key] : { status: 404 };
    if (v instanceof Error) throw v;
    if (v && typeof v === "object" && "status" in (v as object) && Object.keys(v as object).length === 1) return new Response("nope", { status: (v as { status: number }).status });
    return new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, calls };
}

const WPG = { results: [{ name: "Winnipeg", latitude: 49.8844, longitude: -97.14704, country_code: "CA", admin1: "Manitoba" }] };
const DAY = { daily: { time: ["2026-11-24"], weather_code: [71], temperature_2m_max: [-5.1], temperature_2m_min: [-12.2] }, current: { temperature_2m: -8.4, weather_code: 71 } };

describe("where the job is", () => {
  test("the city is tried first, then likely place names from the address; street lines and postal codes are skipped", () => {
    expect(placeCandidates({ city: "Winnipeg", province: "MB", address: "420 Laidlaw Blvd, Winnipeg, MB R3P 0K9" })).toEqual(["Winnipeg"]);
    expect(placeCandidates({ city: null, province: null, address: "420 Laidlaw Blvd, Steinbach, MB R5G 1Z9" })).toEqual(["Steinbach"]);
    expect(placeCandidates({ city: "", province: null, address: "Winnipeg, MB" })).toEqual(["Winnipeg"]);
    expect(placeCandidates({ city: null, province: null, address: null })).toEqual([]);
    expect(placeCandidates({ city: null, province: null, address: "123 Main St" })).toEqual([]);
  });
  test("the match in the job's province is preferred over a same-named place elsewhere", async () => {
    const { f } = canned({ "geocoding-api": { results: [{ name: "Brandon", latitude: 27.9, longitude: -82.3, country_code: "US", admin1: "Florida" }, { name: "Brandon", latitude: 49.85, longitude: -99.95, country_code: "CA", admin1: "Manitoba" }] } });
    expect(await geocodePlace(f, { city: "Brandon", province: "MB", address: null })).toEqual({ latitude: 49.85, longitude: -99.95, place: "Brandon, Manitoba" });
  });
  test("nothing found, a bad answer or a failed call all mean no location", async () => {
    expect(await geocodePlace(canned({ "geocoding-api": {} }).f, { city: "Nowhereville", province: null, address: null })).toBeNull();
    expect(await geocodePlace(canned({ "geocoding-api": { results: [{ name: "X", latitude: "north", longitude: null }] } }).f, { city: "X", province: null, address: null })).toBeNull();
    expect(await geocodePlace(canned({ "geocoding-api": new Error("network down") }).f, { city: "Winnipeg", province: null, address: null })).toBeNull();
    expect(await geocodePlace(canned({ "geocoding-api": { status: 500 } }).f, { city: "Winnipeg", province: null, address: null })).toBeNull();
  });
});

describe("the day's weather", () => {
  test("recent days come from the forecast service, older days from the archive, in Winnipeg time", () => {
    const today = weatherUrl({ latitude: 49.88, longitude: -97.15, date: "2026-11-24", today: "2026-11-24" })!;
    expect(today).toContain("https://api.open-meteo.com/v1/forecast?");
    expect(today).toContain("start_date=2026-11-24&end_date=2026-11-24");
    expect(today).toContain("timezone=America%2FWinnipeg");
    expect(today).toContain("current=temperature_2m,weather_code");
    const lastWeek = weatherUrl({ latitude: 49.88, longitude: -97.15, date: "2026-11-17", today: "2026-11-24" })!;
    expect(lastWeek).toContain("api.open-meteo.com/v1/forecast");
    expect(lastWeek).not.toContain("current=");
    expect(weatherUrl({ latitude: 49.88, longitude: -97.15, date: "2026-03-02", today: "2026-11-24" })).toContain("https://archive-api.open-meteo.com/v1/archive?");
    expect(weatherUrl({ latitude: 49.88, longitude: -97.15, date: "2026-11-30", today: "2026-11-24" })).toBeNull();
    expect(weatherUrl({ latitude: 49.88, longitude: -97.15, date: "not a date", today: "2026-11-24" })).toBeNull();
  });
  test("weather codes read as plain conditions; an unknown code has no words", () => {
    expect(conditionsFor(0)).toBe("Clear");
    expect(conditionsFor(3)).toBe("Overcast");
    expect(conditionsFor(63)).toBe("Rain");
    expect(conditionsFor(71)).toBe("Light snow");
    expect(conditionsFor(95)).toBe("Thunderstorm");
    expect(conditionsFor(1234)).toBeNull();
  });
  test("a good answer gives conditions, high, low and, for today, the temperature now", async () => {
    const { f } = canned({ "api.open-meteo.com/v1/forecast": DAY });
    expect(await fetchDayWeather(f, { latitude: 49.88, longitude: -97.15, date: "2026-11-24", today: "2026-11-24" })).toEqual({ code: 71, conditions: "Light snow", tempNowC: -8.4, highC: -5.1, lowC: -12.2 });
  });
  test("a past day never carries a 'now' temperature", async () => {
    const { f } = canned({ "archive-api": { daily: { time: ["2026-03-02"], weather_code: [3], temperature_2m_max: [1], temperature_2m_min: [-9] }, current: { temperature_2m: 15 } } });
    expect(await fetchDayWeather(f, { latitude: 49.88, longitude: -97.15, date: "2026-03-02", today: "2026-11-24" })).toEqual({ code: 3, conditions: "Overcast", tempNowC: null, highC: 1, lowC: -9 });
  });
  test("missing, null or wrong-day values are not weather", async () => {
    const at = { latitude: 49.88, longitude: -97.15, date: "2026-11-24", today: "2026-11-24" };
    expect(await fetchDayWeather(canned({ forecast: { daily: { time: ["2026-11-24"], weather_code: [null], temperature_2m_max: [null], temperature_2m_min: [null] } } }).f, at)).toBeNull();
    expect(await fetchDayWeather(canned({ forecast: { daily: { time: ["2026-11-23"], weather_code: [71], temperature_2m_max: [-5], temperature_2m_min: [-12] } } }).f, at)).toBeNull();
    expect(await fetchDayWeather(canned({ forecast: { daily: { time: ["2026-11-24"], weather_code: [1234], temperature_2m_max: [-5], temperature_2m_min: [-12] } } }).f, at)).toBeNull();
    expect(await fetchDayWeather(canned({ forecast: { error: true, reason: "bad" } }).f, at)).toBeNull();
    expect(await fetchDayWeather(canned({ forecast: { status: 503 } }).f, at)).toBeNull();
    expect(await fetchDayWeather(canned({ forecast: new Error("timeout") }).f, at)).toBeNull();
  });
});

describe("weather for a log", () => {
  const job = { city: "Winnipeg", province: "MB", address: "Winnipeg, MB" };
  const now = "2026-11-24T20:00:00.000Z";
  test("geocodes the job, fetches the day and returns what to store, with the location cached on the log", async () => {
    const { f, calls } = canned({ "geocoding-api": WPG, "v1/forecast": DAY });
    expect(await weatherForLog(f, { job, date: "2026-11-24", today: "2026-11-24", cached: null, now })).toEqual({
      weather_status: "ok", weather_conditions: "Light snow", weather_code: 71, temp_now_c: -8.4, temp_high_c: -5.1, temp_low_c: -12.2,
      weather_place: "Winnipeg, Manitoba", latitude: 49.8844, longitude: -97.14704, weather_fetched_at: now,
    });
    expect(calls.length).toBe(2);
    expect(calls[0]).toContain("https://geocoding-api.open-meteo.com/v1/search?name=Winnipeg");
  });
  test("a location already cached on an earlier log is reused without geocoding again", async () => {
    const { f, calls } = canned({ "geocoding-api": new Error("should not be called"), "v1/forecast": DAY });
    const out = await weatherForLog(f, { job, date: "2026-11-24", today: "2026-11-24", cached: { latitude: 49.9, longitude: -97.1, place: "Winnipeg, Manitoba" }, now });
    expect(out.weather_status).toBe("ok");
    expect(out.latitude).toBe(49.9);
    expect(calls.length).toBe(1);
  });
  test("an address that cannot be found saves as unavailable, with no weather values at all", async () => {
    const { f, calls } = canned({ "geocoding-api": { results: [] } });
    expect(await weatherForLog(f, { job: { city: null, province: null, address: "Lot 7, Nowhereville" }, date: "2026-11-24", today: "2026-11-24", cached: null, now })).toEqual({
      weather_status: "unavailable", weather_conditions: null, weather_code: null, temp_now_c: null, temp_high_c: null, temp_low_c: null,
      weather_place: null, latitude: null, longitude: null, weather_fetched_at: now,
    });
    expect(calls.every((c) => c.includes("geocoding-api"))).toBe(true);
  });
  test("a job with no address at all asks nobody and is unavailable", async () => {
    const { f, calls } = canned({});
    expect((await weatherForLog(f, { job: { city: null, province: null, address: null }, date: "2026-11-24", today: "2026-11-24", cached: null, now })).weather_status).toBe("unavailable");
    expect(calls).toEqual([]);
  });
  test("the weather service failing keeps the location but stores no weather; it never throws", async () => {
    const { f } = canned({ "geocoding-api": WPG, "v1/forecast": new Error("boom") });
    const out = await weatherForLog(f, { job, date: "2026-11-24", today: "2026-11-24", cached: null, now });
    expect(out).toMatchObject({ weather_status: "unavailable", weather_conditions: null, temp_high_c: null, latitude: 49.8844, longitude: -97.14704 });
    const broken = (() => { throw new Error("fetch itself is broken"); }) as never as typeof fetch;
    expect((await weatherForLog(broken, { job, date: "2026-11-24", today: "2026-11-24", cached: null, now })).weather_status).toBe("unavailable");
  });
});
