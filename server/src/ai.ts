/**
 * Разложение большой цели на шаги через LLM (OpenAI-совместимый API).
 * Сервер — тонкий прокси: ключ живёт только здесь, клиент его не видит.
 */

export interface AiConfig {
  readonly apiKey: string;
  /** База OpenAI-совместимого API, например https://api.moonshot.ai/v1 */
  readonly baseUrl: string;
  readonly model: string;
}

export interface DecomposeInput {
  readonly goal: string;
  readonly startDate: string; // YYYY-MM-DD, локальная дата пользователя
  readonly endDate: string;
  readonly load: Readonly<Record<string, number>>; // дата -> сколько дел уже стоит
}

export interface PlanStep {
  readonly date: string;
  readonly text: string;
}

const MAX_STEPS = 20;
const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

export function buildMessages(input: DecomposeInput): { role: string; content: string }[] {
  const busy = Object.entries(input.load)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, n]) => `${d}: ${n} дел`)
    .join("; ");
  return [
    {
      role: "system",
      content:
        "Ты планировщик в приложении для подростков. Разбивай большую цель на конкретные маленькие шаги по дням. " +
        "Каждый шаг — короткое действие до 10 слов, выполнимое за 20-40 минут. " +
        "Не назначай больше одного шага в день и избегай дней с большой нагрузкой. " +
        "Отвечай строго JSON вида {\"steps\":[{\"date\":\"YYYY-MM-DD\",\"text\":\"...\"}]} без пояснений.",
    },
    {
      role: "user",
      content: `Цель: «${input.goal}». Период: с ${input.startDate} по ${input.endDate}. Загрузка по дням: ${busy || "свободно"}.`,
    },
  ];
}

/** Вытаскивает и валидирует шаги из ответа модели; мусор и даты вне диапазона отбрасывает. */
export function parseSteps(raw: string, startDate: string, endDate: string): PlanStep[] | null {
  const cleaned = raw.replace(/```(?:json)?/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
  const steps = (parsed as Record<string, unknown>).steps;
  if (!Array.isArray(steps)) return null;
  const out: PlanStep[] = [];
  for (const s of steps) {
    if (typeof s !== "object" || s === null) continue;
    const { date, text } = s as Record<string, unknown>;
    if (typeof date !== "string" || !DATE_RX.test(date) || date < startDate || date > endDate) continue;
    if (typeof text !== "string" || text.trim().length < 2 || text.length > 200) continue;
    out.push({ date, text: text.trim() });
    if (out.length >= MAX_STEPS) break;
  }
  return out.length > 0 ? out : null;
}

export interface ChatFetch {
  (url: string, init: { method: string; headers: Record<string, string>; body: string }): Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
}

/** Зовёт OpenAI-совместимый chat/completions и разбирает ответ. Бросает Error при сбое сети/API. */
export async function decomposeWithLLM(cfg: AiConfig, input: DecomposeInput, fetchImpl: ChatFetch): Promise<PlanStep[]> {
  const res = await fetchImpl(`${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: buildMessages(input),
      temperature: 0.4,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`llm_${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("llm_empty");
  const steps = parseSteps(content, input.startDate, input.endDate);
  if (!steps) throw new Error("llm_bad_json");
  return steps;
}
