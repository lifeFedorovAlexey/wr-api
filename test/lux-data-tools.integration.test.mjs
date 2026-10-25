import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import postgres from 'postgres';
import {createLuxDataTools,validateLookup} from '../lib/lux/data-tools.mjs';

test('lookup rejects arbitrary commands, invalid dates and unbounded requests',()=>{
  for(const value of [{tool:'sql'},{tool:'statistics',rank:'anything'},{tool:'statistics',date:'2026-02-30'},
    {tool:'statistics',limit:10000},{tool:'history',days:1000},{tool:'lore',champions:['lux'],userId:77}]) assert.throws(()=>validateLookup(value));
});

test('database research filters the full pool, compares exact snapshots and calculates null-safe changes',
  {skip:!process.env.LUX_TEST_DATABASE_URL,timeout:30000},async()=>{
    const url=new URL(process.env.LUX_TEST_DATABASE_URL);
    if(url.hostname!=='127.0.0.1'||url.port!=='15433'||url.pathname!=='/lux_test') throw new Error('Isolated database required');
    const schema=`lux_tools_${randomUUID().replaceAll('-','')}`;
    const sql=postgres(url.href,{max:2,connect_timeout:3,onnotice(){},connection:{search_path:schema,statement_timeout:8000}});
    try {
      await sql.unsafe(`create schema ${schema}`);
      await sql`create table champions(slug text primary key,name text,name_localizations jsonb)`;
      await sql`create table champion_stats_snapshots(id serial primary key,stats_date date,source text,status text,completed_at timestamptz default now())`;
      await sql`create table champion_stats_history(snapshot_id integer,slug text,rank text,lane text,win_rate double precision,pick_rate double precision,ban_rate double precision)`;
      await sql`insert into champions values ('lux','Lux','{"ru_ru":"Люкс","en_us":"Lux"}'),('ahri','Ahri','{"ru_ru":"Ари","en_us":"Ahri"}')`;
      for(let i=0;i<15;i++) await sql`insert into champions values (${`extra${i}`},${`Extra ${i}`},${sql.json({ru_ru:`Другой ${i}`,en_us:`Extra ${i}`})})`;
      await sql`insert into champion_stats_snapshots(stats_date,source,status) values
        ('2026-10-01','cnHistory','completed'),('2026-10-08','cnHistory','completed'),('2026-10-09','cnHistory','running'),('2026-10-10','other','completed')`;
      await sql`insert into champion_stats_history values
        (1,'lux','masterPlus','mid',48,4,10),(2,'lux','masterPlus','mid',49,5,12),
        (1,'ahri','masterPlus','mid',52,8,null),(2,'ahri','masterPlus','mid',51,9,7),
        (2,'lux','masterPlus','support',55,3,12),(2,'lux','diamondPlus','mid',90,3,12),
        (3,'lux','masterPlus','mid',99,3,12),(4,'lux','masterPlus','mid',100,3,12)`;
      for(let i=0;i<15;i++) await sql`insert into champion_stats_history values (2,${`extra${i}`},'masterPlus','mid',${53+i/10},2,3)`;
      const tools=createLuxDataTools(sql);
      const comparison=await tools.execute({tool:'statistics',champions:['Люкс','ahri'],lane:'mid',rank:'masterPlus',showSources:true});
      assert.equal(comparison.data.date,'2026-10-08');assert.equal(comparison.data.rows.length,2);
      assert.equal(comparison.data.rows.find(row=>row.slug==='lux').win_rate,49);
      assert.equal(comparison.data.comparisons[0].winRateDifferencePP,2); // Ahri minus Lux, sorted by slug.
      assert.equal(comparison.sources.length,1);assert.equal(comparison.data.rankAssumed,false);
      const ranking=await tools.execute({tool:'statistics',lane:'mid',rank:'masterPlus',limit:3});
      assert.equal(ranking.data.totalRows,17);assert.equal(ranking.data.rows[0].slug,'extra14');assert.equal(ranking.data.rows.length,3);
      const change=await tools.execute({tool:'history',champions:['lux','ahri'],lane:'mid',rank:'masterPlus',days:7});
      assert.equal(change.data.baselineDate,'2026-10-01');assert.equal(change.data.date,'2026-10-08');
      assert.equal(change.data.rows.find(row=>row.slug==='lux').delta_win_rate,1);
      assert.equal(change.data.rows.find(row=>row.slug==='ahri').delta_win_rate,-1);
      assert.equal(change.data.rows.find(row=>row.slug==='ahri').delta_ban_rate,null);
      const movers=await tools.execute({tool:'history',lane:'mid',rank:'masterPlus'});
      assert.equal(movers.data.totalCompared,2);assert.equal(movers.data.rows[0].slug,'lux');
      assert.equal((await tools.execute({tool:'statistics',champions:['lux'],date:'2026-10-07'})).data.error,'snapshot_not_found');
      assert.equal((await tools.execute({tool:'history',champions:['lux'],compareDate:'2026-10-02'})).data.error,'baseline_not_found');
      assert.equal((await tools.execute({tool:'statistics'})).data.needsClarification,'lane');
      assert.equal((await tools.execute({tool:'statistics',champions:['Unknown']})).data.error,'champion_not_found');
      assert.equal((await tools.execute({tool:'statistics',champions:['lux'],lane:'jungle'})).data.rows.length,0);
      assert.equal((await tools.execute({tool:'statistics',champions:['lux'],lane:'mid'})).data.rankAssumed,true);
    } finally {await sql.unsafe(`drop schema if exists ${schema} cascade`);await sql.end({timeout:2});}
  });
