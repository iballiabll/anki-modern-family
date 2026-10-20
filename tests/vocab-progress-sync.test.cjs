const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'iball-vocab-sync-'));
process.env.DATA_DIR=scratch;
process.env.SESSION_SECRET='test-vocab-sync-only';
process.env.APP_USERNAME='iball';
const session=require('../api/_session.js');
const handler=require('../api/progress.js');
const telemetry=require('../api/_telemetry.js');
after(async()=>{await telemetry.flush();fs.rmSync(scratch,{recursive:true,force:true});});
function call(method,body,cookie){
  return new Promise((resolve,reject)=>{
    let status=200;
    const response={setHeader(){},status(s){status=s;return this;},json(value){resolve({status,value});return this;},end(){resolve({status});}};
    Promise.resolve(handler({method,headers:{...(cookie?{cookie}:{}),host:'localhost'},body:body?JSON.stringify(body):undefined,socket:{remoteAddress:'127.0.0.1'}},response)).catch(reject);
  });
}
test('basic vocabulary progress/favorites/wordbook round-trip through the real authenticated API',async()=>{
  assert.equal((await call('GET')).status,401);
  const cookie=`${session.COOKIE_NAME}=${session.createOwnerSession()}`;
  const records={'basic::week':{deck:'basic',word:'week',status:'unknown',reviews:1,lastAt:new Date().toISOString()}};
  const entries={
    iball_vocab_recite_v1:{t:Date.now(),v:{version:1,records,history:[]}},
    iball_vocab_favorites_v1:{t:Date.now(),v:['week']},
    iball_vocab_wordbook_v1:{t:Date.now(),v:[{word:'week',meaning:'星期'}]},
  };
  const saved=await call('POST',{entries,tombstones:{}},cookie);
  assert.equal(saved.status,200);
  const secondDevice=await call('GET',undefined,cookie);
  assert.equal(secondDevice.status,200);
  assert.deepEqual(secondDevice.value.entries.iball_vocab_recite_v1.v.records,records);
  assert.deepEqual(secondDevice.value.entries.iball_vocab_favorites_v1.v,['week']);
  assert.equal(secondDevice.value.entries.iball_vocab_wordbook_v1.v[0].word,'week');
  assert.ok(fs.readdirSync(path.join(scratch,'progress')).some(n=>n.endsWith('.json')));
});

test('all 1440 words plus 500 history events survive a serialized device snapshot',async()=>{
  const entries=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/basic-level1-2.json'),'utf8')).entries;
  const at=new Date().toISOString();
  const records=Object.fromEntries(entries.map(e=>[`basic::${e.word.toLowerCase()}`,{deck:'basic',word:e.word,status:'known',reviews:1,firstAt:at,lastAt:at,source:'vocab-list:basic'}]));
  const history=entries.slice(-500).map(e=>({deck:'basic',word:e.word,status:'known',at,source:'vocab-list:basic'}));
  const value=JSON.stringify({version:1,records,history,updatedAt:at});
  assert.ok(Buffer.byteLength(value)>256*1024);
  const cookie=`${session.COOKIE_NAME}=${session.createOwnerSession()}`;
  const saved=await call('POST',{entries:{iball_vocab_recite_v1:{t:Date.now()+1,v:value}}},cookie);
  assert.equal(saved.status,200);
  const result=await call('GET',undefined,cookie);
  assert.equal(Object.keys(result.value.entries.iball_vocab_recite_v1.v.records).length,1440);
  assert.equal(result.value.entries.iball_vocab_recite_v1.v.history.length,500);
});
