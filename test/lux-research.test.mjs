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
