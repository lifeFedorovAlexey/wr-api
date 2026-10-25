import { randomUUID } from "node:crypto";
import { luxError } from "./config.mjs";

export async function setupLuxTables(sql) {
  await sql`create table if not exists lux_conversations (
    user_id integer primary key references site_users(id) on delete cascade,
    summary text not null default '', through_id integer not null default 0,
    entities jsonb not null default '[]', lease_token uuid, lease_until timestamptz,
    updated_at timestamptz not null default now()
  )`;
  await sql`create table if not exists lux_turns (
    id serial primary key, user_id integer not null references lux_conversations(user_id) on delete cascade,
    request_id uuid not null, body text not null, reply text,
    status text not null check (status in ('pending', 'complete', 'failed')),
    sources jsonb not null default '[]', error_code text,
    created_at timestamptz not null default now(), completed_at timestamptz,
    unique(user_id, request_id)
  )`;
  await sql`create index if not exists lux_turns_user_id_idx on lux_turns(user_id, id)`;
  await sql`create index if not exists lux_turns_search_idx on lux_turns using gin(to_tsvector('russian', body || ' ' || coalesce(reply, '')))`;
}

export function createLuxStore(sql) {
  const transaction = callback => sql.begin ? sql.begin(callback) : sql.savepoint(callback);
  return {
    async history(userId, before = 2147483647) {
      const rows = await sql`select t.id, t.request_id, t.body, t.reply, t.sources, t.created_at,
        case when t.status='pending' and (c.lease_until is null or c.lease_until < now()) then 'failed' else t.status end as status,
        case when t.status='pending' and (c.lease_until is null or c.lease_until < now()) then 'lux_interrupted' else t.error_code end as error_code
        from lux_turns t join lux_conversations c on c.user_id=t.user_id
        where t.user_id=${userId} and t.id < ${before} order by t.id desc limit 51`;
      const hasMore = rows.length > 50;
      return { turns: rows.slice(0, 50).reverse(), hasMore };
    },
    async claim(userId, requestId, body) {
      return transaction(async tx => {
        await tx`insert into lux_conversations(user_id) values (${userId}) on conflict do nothing`;
        const [memory] = await tx`select * from lux_conversations where user_id=${userId} for update`;
        const [existing] = await tx`select * from lux_turns where user_id=${userId} and request_id=${requestId}`;
        if (existing && existing.body !== body) throw luxError("lux_request_conflict", 409);
        if (existing?.status === "complete") return { existing: true };
        if (memory.lease_until && new Date(memory.lease_until).getTime() > Date.now()) {
          if (existing?.status === "pending") return { existing: true };
          throw luxError("lux_busy", 409);
        }
        if (existing) {
          const [newer] = await tx`select id from lux_turns where user_id=${userId} and status='complete' and id>${existing.id} limit 1`;
          if (newer) throw luxError("lux_retry_outdated", 409);
        }
        const [{ count }] = await tx`select count(*)::int as count from lux_turns where user_id=${userId} and created_at > now()-interval '1 minute'`;
        if (!existing && count >= 8) throw luxError("lux_rate_limited", 429);
        // A restarted worker's abandoned request remains visible and can be retried.
        await tx`update lux_turns set status='failed', error_code='lux_interrupted' where user_id=${userId} and status='pending'`;
        const token = randomUUID();
        await tx`update lux_conversations set lease_token=${token}, lease_until=now()+interval '210 seconds' where user_id=${userId}`;
        const [turn] = await tx`insert into lux_turns(user_id, request_id, body, status)
          values (${userId}, ${requestId}, ${body}, 'pending')
          on conflict(user_id, request_id) do update set status='pending', error_code=null returning *`;
        const turns = await tx`select id, body, reply from lux_turns where user_id=${userId} and status='complete'
          and id>${memory.through_id} order by id`;
        return { token, turn, memory, turns };
      });
    },
    async finish(userId, claim, result, publish) {
      return transaction(async tx => {
        const [owned] = await tx`select user_id from lux_conversations where user_id=${userId} and lease_token=${claim.token} for update`;
        if (!owned) return false; // Reset or a newer worker invalidated this generation.
        if (publish) await publish(tx);
        // Drizzle changes postgres.js JSON serializers on the shared client. Bind JSON as text explicitly.
        await tx`update lux_turns set reply=${result.reply}, status='complete', sources=${tx.typed(JSON.stringify(result.sources), 25)}::jsonb,
          completed_at=now(), error_code=null where user_id=${userId} and id=${claim.turn.id}`;
        await tx`update lux_conversations set summary=${result.summary}, through_id=${result.throughId},
          entities=${tx.typed(JSON.stringify(result.entities), 25)}::jsonb, lease_token=null, lease_until=null, updated_at=now() where user_id=${userId}`;
        return true;
      });
    },
    async fail(userId, claim, code) {
      await transaction(async tx => {
        const [owned] = await tx`update lux_conversations set lease_token=null, lease_until=null
          where user_id=${userId} and lease_token=${claim.token} returning user_id`;
        if (owned) await tx`update lux_turns set status='failed', error_code=${code} where user_id=${userId} and id=${claim.turn.id}`;
      });
    },
    async recall(userId, body, throughId) {
      const words = [...new Set(body.toLowerCase().match(/[\p{L}]{4,}/gu) || [])].slice(0, 12);
      if (!words.length || !throughId) return [];
      const rows = await sql`select id, left(body, 450) as body, left(reply, 450) as reply from lux_turns
        where user_id=${userId} and status='complete' and id<=${throughId}
        and to_tsvector('russian', body || ' ' || coalesce(reply, '')) @@ to_tsquery('russian', ${words.join(' | ')})
        order by id desc limit 2`;
      return rows;
    },
    async reset(userId) {
      // Deleting the lease invalidates any response still in flight.
      await sql`delete from lux_conversations where user_id=${userId}`;
    },
  };
}
