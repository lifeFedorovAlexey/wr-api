import 'dotenv/config';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { luxConfig } from '../lib/lux/config.mjs';
import { createLuxProvider } from '../lib/lux/provider.mjs';
import { prepareLuxContext } from '../lib/lux/context.mjs';
import { researchLux } from '../lib/lux/research.mjs';

export async function runLuxWorker({env=process.env,fetchImpl=fetch,signal,once=false}={}) {
  const api = new URL(env.WR_API_ORIGIN || 'https://wildriftallstats.ru/wr-api');
  if (api.username || api.password || api.search || api.hash ||
    (api.protocol !== 'https:' && !(api.protocol === 'http:' && ['127.0.0.1','localhost'].includes(api.hostname)))) throw new Error('Invalid Lux API origin');
  if (!env.GUIDES_SYNC_SECRET) throw new Error('GUIDES_SYNC_SECRET is required');
  const config = luxConfig({...env,LUX_LM_STUDIO_MODEL:env.LUX_LM_STUDIO_MODEL || 'lux-local'});
  const provider = createLuxProvider(config,fetchImpl);
  const endpoint = `${api.href.replace(/\/+$/,'')}/api/internal/chat/lux/worker`;
  async function request(payload) {
    const response = await fetchImpl(endpoint,{method:'POST',redirect:'error',
      headers:{Authorization:`Bearer ${env.GUIDES_SYNC_SECRET}`,'Content-Type':'application/json'},
      body:JSON.stringify(payload),signal:AbortSignal.any([AbortSignal.timeout(20000),...(signal?[signal]:[])])});
    if (!response.ok) throw new Error(`Lux API status ${response.status}`);
    return response.json();
  }
  console.log('[lux] Worker ready; model requests stay on local LM Studio.');
  while (!signal?.aborted) {
    let heartbeat;
    try {
      const {job} = await request({action:'take'});
      if (job) {
        heartbeat=setInterval(() => void request({action:'heartbeat'}).catch(() => {}),8000);
        let result;
        try {
          const deadline=AbortSignal.any([AbortSignal.timeout(170000),...(signal?[signal]:[])]);
          const knowledge=job.researchVersion===1 ? await researchLux({job,provider,signal:deadline,
            lookup:query=>request({action:'lookup',messageId:job.messageId,token:job.token,request:query})}) : job.knowledge;
          const context=await prepareLuxContext({...job,knowledge,provider,config,signal:deadline});
          result={reply:await provider.complete(context.messages,{signal:deadline}),summary:context.summary,throughId:context.throughId};
        } catch(error) {
          console.warn('[lux] Generation unavailable:', /^lux_[a-z_]+$/.test(error.message)?error.message:'upstream unavailable');
          result={error:true};
        }
        // Retry acknowledgement with the same lease; never generate or publish a duplicate reply.
        let sent=false;
        for(let attempt=0;attempt<3 && !sent;attempt++) {
          try {await request({action:'complete',messageId:job.messageId,token:job.token,...result});sent=true;}
          catch(error) {if(attempt===2) throw error;await sleep(1000);}
        }
        console.log(`[lux] Chat message ${job.messageId}: ${result.error ? 'generation unavailable' : 'answered'}`);
      }
    } catch(error) {
      // Do not log tokens, prompts, personal memories or provider responses.
      console.warn('[lux]',/^Lux API status \d+$/.test(error.message) ? error.message : 'Connection unavailable; retrying');
      if(once) throw error;
    } finally {clearInterval(heartbeat);}
    if(once) return;
    await sleep(2000,undefined,{signal}).catch(() => {});
  }
}

if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller=new AbortController();
  process.once('SIGINT',() => controller.abort());
  process.once('SIGTERM',() => controller.abort());
  await runLuxWorker({signal:controller.signal,once:process.argv.includes('--once')});
}
