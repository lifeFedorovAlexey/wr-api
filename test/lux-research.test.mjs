import test from 'node:test';
import assert from 'node:assert/strict';
import {researchLux} from '../lib/lux/research.mjs';
import {createLuxProvider} from '../lib/lux/provider.mjs';
import {luxConfig} from '../lib/lux/config.mjs';
const job={body:'Сравни Люкс и Ари на миде',memory:{summary:'Мастер',entities:[]},turns:[],knowledge:{lore:[]}};

test('research can correct a lookup after inspecting results and never posts the plan as dialogue',async()=>{
  const requests=[];let count=0;
  const decisions=[{tool:'statistics',champions:['Arhi']},{tool:'champions',query:'Ahri'},{tool:'statistics',champions:['lux','ahri']},{tool:'done'}];
  const provider={complete:async(messages,{schema})=>{
    assert.ok(schema);if(count>0) assert.ok(JSON.parse(messages[1].content).results.length);
    return decisions[count++];
  }};
  const data=await researchLux({job,provider,lookup:async query=>{requests.push(query);return {data:query.tool==='champions'?{champions:[{slug:'ahri'}]}:{rows:[]}};}});
  assert.equal(requests.length,3);assert.equal(data.lookups.length,3);
});
test('social conversation can finish without retrieving statistics',async()=>{
  const data=await researchLux({job:{...job,body:'@Люкс привет'},provider:{complete:async()=>({tool:'done'})},lookup:async()=>assert.fail('unwanted lookup')});
  assert.deepEqual(data.lookups,[]);
});
test('repeated requests are bounded',async()=>{
  let calls=0;
  await researchLux({job,provider:{complete:async()=>({tool:'statistics'})},lookup:async()=>{calls++;return {data:{rows:[]}};}});
  assert.equal(calls,1);
});
test('provider uses LM Studio structured JSON output for decisions',async()=>{
  const provider=createLuxProvider(luxConfig({LUX_LM_STUDIO_MODEL:'local'}),async(_url,init)=>{
    const body=JSON.parse(init.body);assert.equal(body.response_format.type,'json_schema');assert.equal(body.response_format.json_schema.strict,true);
    return {ok:true,json:async()=>({choices:[{message:{content:'{"tool":"done"}'}}]})};
  });
  assert.deepEqual(await provider.complete([],{schema:{type:'object'}}),{tool:'done'});
});

test('a malformed plan is retried once with more output space',async()=>{
  let calls=0;
  const data=await researchLux({job,provider:{complete:async(_messages,options)=>{
    if(calls++===0) throw new Error('lux_invalid_plan');
    assert.equal(options.outputBudget,3072);return {tool:'done'};
  }},lookup:async()=>assert.fail('unexpected lookup')});
  assert.equal(calls,2);assert.deepEqual(data.lookups,[]);
});

test('repeated planner failure preserves valid data and lets the character answer instead of going silent',async()=>{
  let calls=0;
  const data=await researchLux({job,provider:{complete:async()=>{
    if(calls++===0)return {tool:'statistics'};
    throw new Error('lux_response_truncated');
  }},lookup:async()=>({data:{rows:[{slug:'lulu',lane:'jungle',win_rate:null}]}})});
  assert.equal(calls,3);assert.equal(data.retrievalUnavailable,true);
  assert.equal(data.lookups[0].result.rows[0].slug,'lulu');
});

test('a failed data endpoint becomes an explicit unavailable result',async()=>{
  const data=await researchLux({job,provider:{complete:async()=>({tool:'statistics'})},lookup:async()=>{throw new Error('Lux API status 503');}});
  assert.equal(data.lookups[0].result.error,'lookup_unavailable');
});

test('structured replies accept a JSON fence but reject truncated output and arbitrary prose',async()=>{
  const config=luxConfig({LUX_LM_STUDIO_MODEL:'local'});
  const provider=(content,finish_reason='stop')=>createLuxProvider(config,async(_url,init)=>{
    assert.ok(JSON.parse(init.body).max_tokens>=2048);
    return {ok:true,json:async()=>({choices:[{finish_reason,message:{content}}]})};
  });
  assert.deepEqual(await provider('```json\n{"tool":"done"}\n```').complete([],{schema:{}}),{tool:'done'});
  await assert.rejects(provider('{"tool":"do','length').complete([],{schema:{}}),/lux_response_truncated/);
  await assert.rejects(provider('Here is an explanation').complete([],{schema:{}}),/lux_invalid_plan/);
});
