/**
 * The automatic takeoff's optional AI helper: "which finish does this room get?", for rooms the drawings leave
 * without one. Only text goes to the model: each room's number, name and the words lettered inside it, the room
 * finish schedule's rows, and the finishes it may choose from. No drawing, price or cost is sent. The answer is a
 * suggestion: the takeoff marks it as the AI's, rates it low, and a person accepts or changes it.
 */
export type DecideRoom = { id: string; number: string; name: string; texts: string[] };
export type DecideRow = { number: string; name: string; floor: string; base: string };
export type DecideInput = { rooms: DecideRoom[]; finishes: string[]; schedule: DecideRow[] };
export type Decision = { id: string; tag: string; reason: string };

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const flat = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Checks and trims what the takeoff workspace sent. Throws "Invalid request" when it is not this shape. */
export function cleanDecideInput(d: unknown): DecideInput {
  const bad = () => new Error("Invalid request");
  if (!d || typeof d !== "object") throw bad();
  const r = d as { rooms?: unknown; finishes?: unknown; schedule?: unknown };
  if (!Array.isArray(r.rooms) || r.rooms.length === 0 || r.rooms.length > 200) throw bad();
  if (!Array.isArray(r.finishes) || r.finishes.length > 200) throw bad();
  if (r.schedule !== undefined && (!Array.isArray(r.schedule) || r.schedule.length > 400)) throw bad();
  const rooms = r.rooms.map((x) => {
    const o = (x ?? {}) as { id?: unknown; number?: unknown; name?: unknown; texts?: unknown };
    const id = text(o.id, 80);
    if (!id) throw bad();
    return { id, number: text(o.number, 20), name: text(o.name, 80), texts: (Array.isArray(o.texts) ? o.texts : []).slice(0, 30).map((t) => text(t, 60)).filter(Boolean) };
  });
  const finishes = r.finishes.map((f) => text(f, 40)).filter(Boolean);
  const schedule = ((r.schedule as unknown[]) ?? []).map((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    return { number: text(o["number"], 20), name: text(o["name"], 80), floor: text(o["floor"], 40), base: text(o["base"], 40) };
  });
  return { rooms, finishes, schedule };
}

/** Every finish an answer may name: the job's finishes and the codes the schedule uses. */
export function allowedFinishes(input: DecideInput): string[] {
  const out: string[] = [];
  for (const t of [...input.finishes, ...input.schedule.map((r) => r.floor)]) if (t && !out.some((o) => flat(o) === flat(t))) out.push(t);
  return out;
}

export function buildDecideRequest(input: DecideInput): { system: string; prompt: string; maxTokens: number } {
  const allowed = allowedFinishes(input);
  return {
    system:
      "You help a flooring estimator read construction drawings. For each room you are given, decide which FLOOR finish it gets, using only what the drawings say: the room's name and number, the words lettered inside the room, and how the room finish schedule treats rooms like it. Choose only from the ALLOWED FINISHES list, written exactly as listed. If the drawings do not give enough to decide, answer null for that room: a wrong finish costs more than no answer. Never invent a finish. Reply with a JSON array only.",
    prompt: [
      'Return a JSON array with one item per room: {"id": the room id as given, "tag": one of the allowed finishes or null, "reason": one short sentence naming what in the drawings decided it}.',
      `ALLOWED FINISHES:\n${allowed.length ? allowed.join("\n") : "(none)"}`,
      input.schedule.length ? `ROOM FINISH SCHEDULE (number | name | floor | base):\n${input.schedule.map((r) => `${r.number} | ${r.name} | ${r.floor || "-"} | ${r.base || "-"}`).join("\n")}` : "ROOM FINISH SCHEDULE: none could be read.",
      `ROOMS TO DECIDE:\n${input.rooms.map((r) => JSON.stringify({ id: r.id, number: r.number, name: r.name, lettered_inside: r.texts })).join("\n")}`,
    ].join("\n\n"),
    maxTokens: Math.min(8000, 400 + input.rooms.length * 90),
  };
}

/** The usable answers in a model reply: for a room that was asked about, naming an allowed finish. The rest are dropped. */
export function parseDecisions(reply: string, input: DecideInput): Decision[] {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(reply)?.[1] ?? reply;
  const start = fenced.indexOf("[");
  const end = fenced.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let data: unknown;
  try {
    data = JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const ids = new Set(input.rooms.map((r) => r.id));
  const allowed = new Map(allowedFinishes(input).map((t) => [flat(t), t]));
  const seen = new Set<string>();
  const out: Decision[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = text(r["id"], 80);
    const tag = allowed.get(flat(text(r["tag"], 40)));
    if (!ids.has(id) || !tag || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, tag, reason: text(r["reason"], 240) || "No reason given." });
  }
  return out;
}
