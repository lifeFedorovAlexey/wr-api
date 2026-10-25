import { client } from '../db/client.js';
import { getSiteUserSessionFromRequest } from '../lib/siteUserAuth.mjs';
import { getChatChannelAccessForUser } from '../lib/chatGroups.mjs';
import { createLuxChatQueue } from '../lib/lux/chat-queue.mjs';
import { setCors } from './utils/cors.js';

export function createLuxHandler({ getSession, authorizeChannel, getStatus, reset, enabled }) {
  return async (req,res) => {
    setCors(req,res); res.setHeader('Cache-Control','no-store');
    if (req.method === 'OPTIONS') return res.status(204).end();
    try {
      const session = await getSession(req);
      if (!session?.user?.id) return res.status(401).json({ error:'unauthorized' });
      if (req.method === 'GET') {
        const channelId = Number(req.query?.channelId);
        if (!Number.isInteger(channelId) || channelId<=0) return res.status(400).json({error:'chat_channel_required'});
        await authorizeChannel(session.user,channelId);
        return res.status(200).json({ participant: enabled() ? await getStatus(channelId) : null });
      }
      if (req.method === 'DELETE') {
        await reset(Number(session.user.id));
        return res.status(200).json({cleared:true});
      }
      return res.status(405).json({error:'method_not_allowed'});
    } catch {
      return res.status(503).json({error:'lux_unavailable'});
    }
  };
}
export default createLuxHandler({
  getSession:getSiteUserSessionFromRequest, authorizeChannel:getChatChannelAccessForUser,
  getStatus:channelId => createLuxChatQueue(client).status(channelId),
  enabled:() => process.env.LUX_ENABLED === 'true',
  reset:userId => client.begin(async tx => {
    await tx`update lux_chat_queue set state='cancelled' where user_id=${userId} and state in ('queued','processing')`;
    await tx`delete from lux_conversations where user_id=${userId}`;
  }),
});
