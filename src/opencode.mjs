const fallbackFreeModels = [
  { id: "big-pickle", name: "Big Pickle", free: true },
  { id: "mimo-v2.5-free", name: "MiMo-V2.5 Free", free: true },
  { id: "ling-3.0-flash-fin-free", name: "Ling 3.0 Flash Fin Free", free: true },
  { id: "nemotron-3-ultra-free", name: "Nemotron 3 Ultra Free", free: true },
  { id: "nemotron-3.5-lightning-free", name: "Nemotron 3.5 Lightning Free", free: true },
  { id: "muse-spark-1.2-contributor-free", name: "Muse Spark 1.2 Contributor Free", free: true }
];

function responseText(body) {
  if (typeof body?.output_text === "string") return body.output_text.trim();
  const chunks = [];
  for (const item of body?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (typeof content?.text === "string") chunks.push(content.text);
      if (typeof content?.output_text === "string") chunks.push(content.output_text);
    }
  }
  return chunks.join("\n").trim();
}

function modelList(body) {
  const values = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
  return values
    .map((item) => ({
      id: item?.id,
      name: item?.name ?? item?.id,
      free: /free|pickle/i.test(`${item?.id} ${item?.name ?? ""}`)
    }))
    .filter((item) => item.id);
}

export function isRotationError(status, body) {
  const text = typeof body === "string" ? body : JSON.stringify(body ?? {});
  return status === 401 || status === 402 || status === 429 || (status === 403 && /limit|quota|rate|credit/i.test(text));
}

export class OpenCodeClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  async request(path, token, options = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(options.headers ?? {})
      }
    });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!response.ok) {
      const error = new Error(`OpenCode Zen API ${response.status}`);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  async listModels(token) {
    try {
      const models = modelList(await this.request("/models", token));
      return models.length ? models : fallbackFreeModels;
    } catch {
      return fallbackFreeModels;
    }
  }

  async complete(token, { model, system, prompt, maxOutputTokens = 3000 }) {
    const body = await this.request("/responses", token, {
      method: "POST",
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: [{ type: "input_text", text: system }] },
          { role: "user", content: [{ type: "input_text", text: prompt }] }
        ],
        max_output_tokens: maxOutputTokens
      })
    });
    const text = responseText(body);
    if (!text) throw new Error("OpenCode Zen returned an empty response.");
    return text;
  }
}

export { fallbackFreeModels };