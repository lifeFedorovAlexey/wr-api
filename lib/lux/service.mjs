import { luxConfig, luxError, LUX_PERSONA } from "./config.mjs";
import { createLuxProvider } from "./provider.mjs";
import { prepareLuxContext } from "./context.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateLuxMessage(input) {
  const body = typeof input?.body === "string" ? input.body.trim() : "";
  if (!body || body.length > 2000 || !UUID.test(input?.requestId || "")) throw luxError("lux_invalid_message", 400);
  return { body, requestId: input.requestId };
}

export function createLuxService({ store, loadKnowledge, config = luxConfig(), provider = createLuxProvider(config) }) {
  const jobs = new Set();
  let reservations = 0;
  async function generate(userId, claim) {
    let stage = "knowledge";
    try {
      const signal = AbortSignal.timeout(180000);
      const { knowledge, sources, entities } = await loadKnowledge(claim.turn.body, claim.memory, claim.turns);
      const recall = await store.recall(userId, claim.turn.body, claim.memory.through_id);
      stage = "memory";
      const prepared = await prepareLuxContext({ memory: claim.memory, turns: claim.turns, body: claim.turn.body, knowledge, recall, provider, config, signal });
      stage = "reply";
      const reply = await provider.complete(prepared.messages, { signal });
      stage = "save";
      await store.finish(userId, claim, { ...prepared, reply, sources, entities });
    } catch (error) {
      const code = ["lux_unavailable", "lux_model_required", "lux_empty_response", "lux_context_full"].includes(error.message)
        ? error.message : "lux_unavailable";
      console.warn("[lux] generation failed", { stage, code, upstreamStatus: error.upstreamStatus || null, databaseCode: /^[A-Z0-9_]{1,40}$/.test(error.code || "") ? error.code : null });
      await store.fail(userId, claim, code).catch(() => {}); // The lease also recovers from database outages.
    }
  }
  return {
    async history(userId, before) {
      return { ...await store.history(userId, before), persona: LUX_PERSONA, enabled: config.enabled };
    },
    async send(userId, input) {
      if (!config.enabled) throw luxError("lux_disabled");
      const { body, requestId } = validateLuxMessage(input);
      if (jobs.size + reservations >= 2) throw luxError("lux_busy", 429);
      reservations++;
      let claim;
      try { claim = await store.claim(userId, requestId, body); } finally { reservations--; }
      if (!claim.existing) {
        const job = generate(userId, claim);
        jobs.add(job);
        void job.finally(() => jobs.delete(job));
      }
      return { accepted: true, requestId };
    },
    reset: userId => store.reset(userId),
    // Tests and orderly shutdown can await all accepted work.
    drain: () => Promise.all([...jobs]),
  };
}
