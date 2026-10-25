import { randomUUID } from "node:crypto";
import { createLuxStore, setupLuxTables } from "./store.mjs";
import { luxError } from "./config.mjs";

export function isLuxAddress(body) {
  return /(^|\s)@(?:люкс|lux)(?=$|[^\p{L}\p{N}_])/iu.test(body) ||
    /^\s*(?:(?:привет|здравствуй|здравствуйте|здарова|здорова|здорово|хай|слушай|эй)[,!\s]+)?(?:люкс|lux)(?=$|[\s,:!?.])/iu.test(body);
}

export async function setupLuxChat(sql) {
  await setupLuxTables(sql);
  await sql`create table if not exists lux_chat_identity (
    singleton boolean primary key default true check(singleton),
    user_id integer not null references site_users(id), heartbeat_at timestamptz
  )`;
  await sql`create table if not exists lux_chat_queue (
    message_id integer primary key references chat_messages(id) on delete cascade,
    user_id integer not null references site_users(id) on delete cascade,
    channel_id integer not null references chat_channels(id) on delete cascade,
    request_id uuid not null unique, state text not null default 'queued',
    claim jsonb, sources jsonb not null default '[]', entities jsonb not null default '[]',
    lease_until timestamptz, attempts integer not null default 0,
    reply_message_id integer references chat_messages(id) on delete set null,
    created_at timestamptz not null default now()
  )`;
  await sql`create index if not exists lux_chat_queue_pending_idx on lux_chat_queue(state, message_id)`;
  await sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(76209142)`;
    const [existing] = await tx`select user_id from lux_chat_identity where singleton`;
    if (!existing) {
      // A reserved service identity has no OAuth identity or login session.
      const [bot] = await tx`insert into site_users(display_name, status) values ('Люкс', 'service') returning id`;
      await tx`insert into lux_chat_identity(user_id) values (${bot.id})`;
    }
    await tx`insert into chat_group_members(group_id, user_id, role)
      select g.id, b.user_id, 'member' from chat_groups g cross join lux_chat_identity b
      where g.slug='general' on conflict do nothing`;
  });
}

export function createLuxChatQueue(sql) {
  return {
    async recoverRecent() {
      // Recover recent addresses missed by an interrupted enqueue or an older matcher.
      // Existing jobs, including completed/failed ones, are never replayed.
      const messages = await sql`select m.id,m.body from chat_messages m
        join chat_channels c on c.id=m.channel_id join chat_groups g on g.id=c.group_id
        join site_users u on u.id=m.author_user_id
        where m.created_at>now()-interval '15 minutes' and m.deleted_at is null
          and g.slug='general' and not g.is_private and u.status='active'
          and not exists(select 1 from lux_chat_queue q where q.message_id=m.id)
        order by m.id limit 200`;
      let recovered = 0;
      for (const message of messages) {
        if (!isLuxAddress(message.body)) continue;
        await this.enqueue(message);
        recovered++;
      }
      return recovered;
    },
    async enqueue(message) {
      if (!isLuxAddress(message.body)) return;
      // Only the existing public general room participates. Private room history cannot leak here.
      await sql`insert into lux_chat_queue(message_id,user_id,channel_id,request_id)
        select m.id,m.author_user_id,m.channel_id,${randomUUID()} from chat_messages m
        join chat_channels c on c.id=m.channel_id join chat_groups g on g.id=c.group_id
        join site_users u on u.id=m.author_user_id
        where m.id=${message.id} and m.deleted_at is null and g.slug='general' and not g.is_private
          and u.status='active' and m.author_user_id not in(select user_id from lux_chat_identity)
        on conflict do nothing`;
    },
    async status(channelId) {
      const [result] = await sql`select b.user_id as "userId", coalesce(b.heartbeat_at>now()-interval '20 seconds', false) as online,
        (select coalesce(max(reply_message_id),0) from lux_chat_queue where channel_id=${channelId}) as revision,
        (select count(*)::int from lux_chat_queue where channel_id=${channelId} and state in ('queued','processing')) as pending
        from lux_chat_identity b where exists(select 1 from chat_channels c join chat_groups g on g.id=c.group_id
          where c.id=${channelId} and g.slug='general' and not g.is_private)`;
      return result || null;
    },
    async sources(ids) {
      if (!ids.length) return new Map();
      const rows = await sql`select reply_message_id,sources from lux_chat_queue where reply_message_id in ${sql(ids)}`;
      return new Map(rows.map(row => [row.reply_message_id, row.sources]));
    },
    async take() {
      return sql.begin(async tx => {
        await tx`update lux_chat_identity set heartbeat_at=now() where singleton`;
        await tx`update lux_chat_queue set state='expired' where state in ('queued','processing')
          and created_at<now()-interval '15 minutes' and (lease_until is null or lease_until<now())`;
        const [job] = await tx`select q.*,m.body from lux_chat_queue q join chat_messages m on m.id=q.message_id
          where (q.state='queued' or (q.state='processing' and q.lease_until<now()))
          and m.deleted_at is null and q.attempts<3
          and not exists(select 1 from lux_conversations c where c.user_id=q.user_id and c.lease_until>now())
          order by q.message_id for update of q skip locked limit 1`;
        if (!job) return null;
        const claim = await createLuxStore(tx).claim(job.user_id, job.request_id, job.body);
        await tx`update lux_chat_queue set state='processing', attempts=attempts+1,
          claim=${tx.typed(JSON.stringify(claim),25)}::jsonb, lease_until=now()+interval '210 seconds' where message_id=${job.message_id}`;
        return { messageId: job.message_id, userId: job.user_id, claim };
      });
    },
    async attachKnowledge(job, sources, entities) {
      await sql`update lux_chat_queue set sources=${sql.typed(JSON.stringify(sources),25)}::jsonb,
        entities=${sql.typed(JSON.stringify(entities),25)}::jsonb
        where message_id=${job.messageId} and claim->>'token'=${job.claim.token}`;
    },
    async heartbeat() {
      await sql`update lux_chat_identity set heartbeat_at=now() where singleton`;
    },
    async complete(input) {
      if (!Number.isInteger(input?.messageId) || typeof input?.token !== 'string') throw luxError('lux_invalid_result',400);
      return sql.begin(async tx => {
        const [job] = await tx`select q.*,m.deleted_at,m.body as original_body,u.display_name from lux_chat_queue q
          join chat_messages m on m.id=q.message_id join site_users u on u.id=q.user_id
          where q.message_id=${input.messageId} for update of q`;
        if (!job || job.claim?.token !== input.token) throw luxError('lux_stale_job',409);
        if (job.state === 'complete') return { accepted: true }; // lost HTTP acknowledgement
        if (job.state !== 'processing' || new Date(job.lease_until).getTime() < Date.now()) throw luxError('lux_stale_job',409);
        const store = createLuxStore(tx);
        if (input.error || job.deleted_at) {
          await store.fail(job.user_id,job.claim,'lux_unavailable');
          await tx`update lux_chat_queue set state='failed', lease_until=null where message_id=${job.message_id}`;
          return { accepted: true };
        }
        const reply = typeof input.reply === 'string' ? input.reply.trim() : '';
        const summary = typeof input.summary === 'string' ? input.summary : '';
        const throughId = Number(input.throughId);
        const allowedIds = [Number(job.claim.memory.through_id), ...job.claim.turns.map(turn => Number(turn.id))];
        if (!reply || reply.length>6000 || summary.length>1800 || !allowedIds.includes(throughId)) throw luxError('lux_invalid_result',400);
        const result = { reply, summary, throughId, sources: job.sources, entities: job.entities };
        const saved = await store.finish(job.user_id, job.claim, result, async transaction => {
          const [bot] = await transaction`select user_id from lux_chat_identity where singleton`;
          const [message] = await transaction`insert into chat_messages(channel_id,author_user_id,body)
            values (${job.channel_id},${bot.user_id},${`${job.display_name || 'Друг'}, ${reply}`}) returning id`;
          await transaction`update lux_chat_queue set state='complete', lease_until=null, reply_message_id=${message.id} where message_id=${job.message_id}`;
        });
        if (!saved) throw luxError('lux_stale_job',409);
        return { accepted: true };
      });
    },
  };
}
