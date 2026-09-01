const fallbackFreeModels = [
  { id: "big-pickle", name: "Big Pickle", free: true },
  { id: "mimo-v2.5-free", name: "MiMo-V2.5 Free", free: true },
  { id: "ling-3.0-flash-fin-free", name: "Ling 3.0 Flash Fin Free", free: true },
  { id: "nemotron-3-ultra-free", name: "Nemotron 3 Ultra Free", free: true },
  { id: "nemotron-3.5-lightning-free", name: "Nemotron 3.5 Lightning Free", free: true },
  { id: "muse-spark-1.2-contributor-free", name: "Muse Spark 1.2 Contributor Free", free: true }
];

const knownFreeModelIds = new Set(fallbackFreeModels.map((model) => model.id));

function hasZeroPrice(value) {
  return value === 0 || value === "0" || value === "0.0" || value === "0.00";
}

function isFreeModel(item) {
  const id = String(item?.id ?? "").toLowerCase();
  const name = String(item?.name ?? "").toLowerCase();
  const pricing = item?.pricing ?? item?.prices ?? {};
  const inputPrice = pricing.input ?? pricing.prompt ?? pricing.input_token;
  const outputPrice = pricing.output ?? pricing.completion ?? pricing.output_token;
  return knownFreeModelIds.has(id) ||
    Boolean(item?.free) ||
    /free|pickle/.test(`${id} ${name}`) ||
    (hasZeroPrice(inputPrice) && hasZeroPrice(outputPrice));
}

export function isKnownFreeModelId(modelId) {
  const id = String(modelId ?? "").toLowerCase();
  return knownFreeModelIds.has(id) || /free|pickle/.test(id);
}

function responseText(body) {
  if (typeof body?.output_text === "string") return body.output_text.trim();
  if (typeof body?.choices?.[0]?.message?.content === "string") {
    return body.choices[0].message.content.trim();
  }
  if (Array.isArray(body?.choices?.[0]?.message?.content)) {
    return body.choices[0].message.content
      .map((part) => part?.text ?? "")
      .join("")
      .trim();
  }
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
      free: isFreeModel(item)
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
    const usesResponsesApi = /^(gpt-|muse-spark-1\.2-contributor-free$)/i.test(model);
    const endpoint = usesResponsesApi ? "/responses" : "/chat/completions";
    const payload = usesResponsesApi
      ? {
          model,
          input: [
            { role: "system", content: [{ type: "input_text", text: system }] },
            { role: "user", content: [{ type: "input_text", text: prompt }] }
          ],
          max_output_tokens: maxOutputTokens
        }
      : {
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt }
          ],
          max_tokens: maxOutputTokens
        };
    const body = await this.request(endpoint, token, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const text = responseText(body);
    if (!text) throw new Error("OpenCode Zen returned an empty response.");
    return text;
  }
}

export { fallbackFreeModels };