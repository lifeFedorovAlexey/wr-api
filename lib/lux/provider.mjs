import { luxError } from "./config.mjs";

// Conservative estimate for Russian text; leave additional room for model templates.
export function estimateTokens(messages) {
  return messages.reduce((sum, message) => sum + Math.ceil(Buffer.byteLength(message.content, "utf8") / 2) + 16, 128);
}

export function createLuxProvider(config, fetchImpl = fetch) {
  const headers = { "Content-Type": "application/json" };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  async function request(path, init, signal) {
    try {
      const response = await fetchImpl(`${config.baseUrl}${path}`, {
        ...init, headers, signal, redirect: "error",
      });
      if (!response.ok) throw Object.assign(luxError("lux_unavailable"), { upstreamStatus: response.status });
      return await response.json();
    } catch (error) {
      if (error.status) throw error;
      throw luxError("lux_unavailable");
    }
  }
  return {
    async complete(messages, { summary = false, signal, schema } = {}) {
      const maxTokens = summary ? 650 : schema ? 650 : config.replyTokens;
      if (estimateTokens(messages) + maxTokens + 512 > config.contextTokens) throw luxError("lux_context_full");
      const deadline = AbortSignal.any([AbortSignal.timeout(config.timeoutMs), ...(signal ? [signal] : [])]);
      let model = config.model;
      if (!model) {
        const payload = await request("/models", {}, deadline);
        const models = (payload.data || []).filter(item => item.id && !/embed/i.test(item.id));
        if (models.length !== 1) throw luxError("lux_model_required");
        model = models[0].id;
      }
      const payload = await request("/chat/completions", {
        method: "POST",
        body: JSON.stringify({ model, messages, stream: false, temperature: summary || schema ? 0.1 : 0.65, max_tokens: maxTokens,
          ...(schema ? { response_format: { type: 'json_schema', json_schema: { name: 'lux_lookup', strict: true, schema } } } : {}) }),
      }, deadline);
      // Reasoning belongs to the model, never to the displayed character dialogue.
      const text = String(payload.choices?.[0]?.message?.content || "")
        .replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*$/gi, "").trim();
      if (!text) throw luxError("lux_empty_response");
      if (schema) {
        try { return JSON.parse(text); } catch { throw luxError('lux_invalid_plan'); }
      }
      return text.slice(0, summary ? 1800 : 6000);
    },
  };
}
