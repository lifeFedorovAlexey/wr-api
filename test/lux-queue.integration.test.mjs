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
    await sql`create table chat_messages(id serial primary key,channel_id integer,author_user_id integer,body text,deleted_at timestamptz)`;
    await sql`insert into site_users(display_name) values ('Аня'),('Борис')`;
    await sql`insert into chat_groups(slug,is_private) values ('general',false),('private',true)`;
    await sql`insert into chat_channels(group_id) values (1),(2)`;
    await setupLuxChat(sql);await setupLuxChat(sql);
    const queue=createLuxChatQueue(sql);
    const [first]=await sql`insert into chat_messages(channel_id,author_user_id,body) values (1,1,'@Люкс я поддержка') returning id,body`;
    const [second]=await sql`insert into chat_messages(channel_id,author_user_id,body) values (1,2,'@Люкс я лесник') returning id,body`;
    const [privateMessage]=await sql`insert into chat_messages(channel_id,author_user_id,body) values (2,1,'@Люкс секрет') returning id,body`;
    await queue.enqueue(first);await queue.enqueue(first);await queue.enqueue(second);await queue.enqueue(privateMessage);
    assert.equal((await sql`select * from lux_chat_queue`).length,2);
    const one=await queue.take();const two=await queue.take();
    assert.equal(one.userId,1);assert.equal(two.userId,2);assert.equal(two.claim.turns.length,0);
    assert.equal(await queue.take(),null);
    await queue.attachKnowledge(one,[{label:'Статистика',url:'/winrates'}],['lux']);
    const result={messageId:one.messageId,token:one.claim.token,reply:'Привет!',summary:'Поддержка',throughId:0};
    await assert.rejects(queue.complete({...result,token:'wrong'}),/lux_stale_job/);
    await queue.complete(result);await queue.complete(result);
    const replies=await sql`select * from chat_messages where author_user_id=3`;
    assert.equal(replies.length,1);assert.equal(replies[0].channel_id,1);assert.equal(replies[0].body,'Аня, Привет!');
    assert.equal((await queue.sources([replies[0].id])).get(replies[0].id)[0].url,'/winrates');
    await sql`update chat_messages set deleted_at=now() where id=${two.messageId}`;
    await queue.complete({messageId:two.messageId,token:two.claim.token,reply:'must not publish',summary:'',throughId:0});
    assert.equal((await sql`select * from chat_messages where author_user_id=3`).length,1);
    assert.equal((await queue.status(1)).online,true);assert.equal(await queue.status(2),null);
  } finally {
    try {await sql.unsafe(`drop schema if exists ${schema} cascade`);} finally {await sql.end({timeout:2});}
  }
});
