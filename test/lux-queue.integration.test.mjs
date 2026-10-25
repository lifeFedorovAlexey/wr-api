import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import postgres from 'postgres';
import {drizzle} from 'drizzle-orm/postgres-js';
import {setupLuxChat,createLuxChatQueue} from '../lib/lux/chat-queue.mjs';

test('Lux replies once in the source room, isolates authors and excludes private rooms', {skip:!process.env.LUX_TEST_DATABASE_URL,timeout:40000},async () => {
  const url=new URL(process.env.LUX_TEST_DATABASE_URL);
  const dev=url.port==='15432' && url.pathname==='/wildrift_dev' && url.username==='wildrift_app';
  const isolated=url.port==='15433' && url.pathname==='/lux_test' && url.username==='postgres';
  if(url.hostname!=='127.0.0.1' || !(dev || isolated)) throw new Error('Isolated test database required');
  const schema=`lux_queue_test_${randomUUID().replaceAll('-','')}`;
  const sql=postgres(url.href,{max:1,connect_timeout:3,onnotice(){},connection:{search_path:schema,statement_timeout:8000}});
  drizzle(sql);
  try {
    await sql.unsafe(`create schema ${schema}`);
    await sql`create table site_users(id serial primary key,display_name text,status text default 'active')`;
    await sql`create table chat_groups(id serial primary key,slug text,is_private boolean)`;
    await sql`create table chat_channels(id serial primary key,group_id integer)`;
    await sql`create table chat_group_members(group_id integer,user_id integer,role text,primary key(group_id,user_id))`;
    await sql`create table chat_messages(id serial primary key,channel_id integer,author_user_id integer,body text,deleted_at timestamptz,created_at timestamptz default now())`;
    await sql`insert into site_users(display_name) values ('Аня'),('Борис')`;
    await sql`insert into chat_groups(slug,is_private) values ('general',false),('private',true)`;
    await sql`insert into chat_channels(group_id) values (1),(2)`;
    await setupLuxChat(sql);await setupLuxChat(sql);
    const queue=createLuxChatQueue(sql);
    const [first]=await sql`insert into chat_messages(channel_id,author_user_id,body) values (1,1,'люкс здарова') returning id,body`;
    const [second]=await sql`insert into chat_messages(channel_id,author_user_id,body) values (1,2,'@Люкс я лесник') returning id,body`;
    const [privateMessage]=await sql`insert into chat_messages(channel_id,author_user_id,body) values (2,1,'@Люкс секрет') returning id,body`;
    await sql`insert into chat_messages(channel_id,author_user_id,body,created_at) values (1,1,'Люкс старое сообщение',now()-interval '1 hour')`;
    await sql`insert into chat_messages(channel_id,author_user_id,body) values (1,1,'я играю за люкс')`;
    await queue.enqueue(second);await queue.enqueue(privateMessage);
    assert.equal(await queue.recoverRecent(),1);
    assert.equal(await queue.recoverRecent(),0);
    await queue.enqueue(first);
    assert.equal((await sql`select * from lux_chat_queue`).length,2);
    const one=await queue.take();const two=await queue.take();
    assert.equal(one.userId,1);assert.equal(two.userId,2);assert.equal(two.claim.turns.length,0);
    assert.equal(await queue.take(),null);
    await assert.rejects(queue.claimLookup(one.messageId,'wrong'),/lux_stale_or_exhausted_job/);
    await queue.claimLookup(one.messageId,one.claim.token);
    await queue.attachLookup(one.messageId,one.claim.token,{sources:[],entities:['ahri']});
    for(let i=0;i<5;i++) await queue.claimLookup(one.messageId,one.claim.token);
    await assert.rejects(queue.claimLookup(one.messageId,one.claim.token),/lux_stale_or_exhausted_job/);
    await queue.attachKnowledge(one,[{label:'Статистика',url:'/winrates'}],['lux']);
    const result={messageId:one.messageId,token:one.claim.token,reply:'Привет!',summary:'Поддержка',throughId:0};
    await assert.rejects(queue.complete({...result,token:'wrong'}),/lux_stale_job/);
    await queue.complete(result);await queue.complete(result);
    await assert.rejects(queue.claimLookup(one.messageId,one.claim.token),/lux_stale_or_exhausted_job/);
    const replies=await sql`select * from chat_messages where author_user_id=3`;
    assert.equal(replies.length,1);assert.equal(replies[0].channel_id,1);assert.equal(replies[0].body,'Аня, Привет!');
    assert.deepEqual((await queue.sources([replies[0].id])).get(replies[0].id),[]);
    await sql`update chat_messages set deleted_at=now() where id=${two.messageId}`;
    await queue.complete({messageId:two.messageId,token:two.claim.token,reply:'must not publish',summary:'',throughId:0});
    assert.equal((await sql`select * from chat_messages where author_user_id=3`).length,1);
    assert.equal((await queue.status(1)).online,true);assert.equal(await queue.status(2),null);
    const [failure]=await sql`insert into chat_messages(channel_id,author_user_id,body) values (1,1,'Люкс помоги') returning id,body`;
    await queue.enqueue(failure);
    const failedJob=await queue.take();
    await queue.complete({messageId:failedJob.messageId,token:failedJob.claim.token,error:true});
    await queue.complete({messageId:failedJob.messageId,token:failedJob.claim.token,error:true});
    const [failedRow]=await sql`select * from lux_chat_queue where message_id=${failure.id}`;
    assert.equal(failedRow.state,'failed');assert.ok(failedRow.reply_message_id);assert.deepEqual(failedRow.sources,[]);
    assert.equal((await sql`select * from chat_messages where author_user_id=3`).length,2);
    await assert.rejects(queue.retryFailed(failure.id),/lux_retry_unavailable/);
    const [silent]=await sql`insert into chat_messages(channel_id,author_user_id,body) values (1,1,'Люкс лулу в лес норм?') returning id,body`;
    await queue.enqueue(silent);const oldFailure=await queue.take();
    // A pre-fix job failed without publishing any acknowledgement.
    await sql`update lux_conversations set lease_token=null,lease_until=null where user_id=1`;
    await sql`update lux_turns set status='failed' where id=${oldFailure.claim.turn.id}`;
    await sql`update lux_chat_queue set state='failed',lease_until=null where message_id=${silent.id}`;
    assert.equal((await queue.retryFailed(silent.id)).retried,true);
    assert.equal((await queue.take()).messageId,silent.id);
  } finally {
    try {await sql.unsafe(`drop schema if exists ${schema} cascade`);} finally {await sql.end({timeout:2});}
  }
});
