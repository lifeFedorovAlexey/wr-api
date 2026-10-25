import test from 'node:test';
import assert from 'node:assert/strict';
import {isLuxAddress} from '../lib/lux/chat-queue.mjs';
process.env.DATABASE_URL ||= 'postgres://localhost:5432/test';
const {createLuxWorkerHandler} = await import('../api/internal-chat-lux-worker.js');
function response() {return {code:0,body:null,setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};}
test('Lux responds to addresses, not general champion mentions',() => {
  for(const value of ['@Люкс привет','Привет, @lux!','Люкс, посоветуй','Люкс как дела?','Привет, Люкс!']) assert.ok(isLuxAddress(value),value);
  for(const value of ['я играю за Люкс','забань люкс','@luxury привет','@люксовый','люксовый отель']) assert.ok(!isLuxAddress(value),value);
});
test('worker authenticates and retrieves only the claimed author context',async () => {
  const job={messageId:12,userId:7,claim:{token:'lease',turn:{body:'@Люкс привет'},memory:{through_id:2},turns:[]}};
  let allowed=false;const calls=[];
  const handler=createLuxWorkerHandler({authorized:(req,res)=>{if(!allowed) res.status(401).json({error:'unauthorized'});return allowed;},enabled:()=>true,
    queue:{take:async()=>job,attachKnowledge:async(...args)=>calls.push(args)},
    knowledge:async()=>({knowledge:{stats:[]},sources:[],entities:[]}),recall:async(id)=>{calls.push(id);return [];}});
  let res=response();await handler({method:'POST',body:{action:'take'}},res);assert.equal(res.code,401);assert.deepEqual(calls,[]);
  allowed=true;res=response();await handler({method:'POST',body:{action:'take',userId:99}},res);
  assert.equal(res.code,200);assert.equal(calls[0],7);assert.equal(res.body.job.messageId,12);assert.ok(!('userId' in res.body.job));
});
