import { client } from '../db/client.js';
import { ensureAuthorized } from './utils/adminAuth.js';
import { createLuxChatQueue } from '../lib/lux/chat-queue.mjs';
import { createLuxStore } from '../lib/lux/store.mjs';
import { loadLuxKnowledge } from '../lib/lux/knowledge.mjs';

export function createLuxWorkerHandler({ authorized, queue, knowledge, recall, enabled }) {
  return async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    if (!authorized(req,res)) return;
    if (!enabled()) return res.status(503).json({error:'lux_disabled'});
    if (req.method !== 'POST') return res.status(405).json({error:'method_not_allowed'});
    try {
      if (req.body?.action === 'heartbeat') {
        await queue.heartbeat(); return res.status(200).json({ok:true});
      }
      if (req.body?.action === 'complete') return res.status(200).json(await queue.complete(req.body));
      if (req.body?.action !== 'take') return res.status(400).json({error:'lux_invalid_action'});
      const job = await queue.take();
      if (!job) return res.status(200).json({job:null});
      try {
        const data = await knowledge(job.claim.turn.body,job.claim.memory,job.claim.turns);
        const archive = await recall(job.userId,job.claim.turn.body,job.claim.memory.through_id);
        await queue.attachKnowledge(job,data.sources,data.entities);
        return res.status(200).json({job:{ messageId:job.messageId, token:job.claim.token,
          memory:job.claim.memory, turns:job.claim.turns, body:job.claim.turn.body,
          knowledge:data.knowledge, recall:archive }});
      } catch (error) {
        await queue.complete({messageId:job.messageId,token:job.claim.token,error:true});
        throw error;
      }
    } catch (error) {
      return res.status(error.status || 503).json({error:error.status ? error.message : 'lux_unavailable'});
    }
  };
}
export default createLuxWorkerHandler({
  authorized:(req,res) => ensureAuthorized(req,res,{tokenEnvNames:['GUIDES_SYNC_SECRET']}),
  enabled:() => process.env.LUX_ENABLED === 'true', queue:createLuxChatQueue(client),
  knowledge:(body,memory,turns) => loadLuxKnowledge(client,body,memory,turns),
  recall:(...args) => createLuxStore(client).recall(...args),
});
