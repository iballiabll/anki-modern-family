const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root=path.resolve(__dirname,'..');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));

test('basic deck matches all 1440 PDF words and all 36 daily groups',()=>{
  const source=read('data/basic-level1-2.json');
  const deck=read('vocab-index/deck-basic.json');
  assert.equal(source.entries.length,1440);
  assert.deepEqual(deck.words,source.entries.map(e=>e.word));
  assert.equal(deck.groups.length,36);
  assert.ok(deck.groups.every(g=>g.words.length===40));
  assert.deepEqual(deck.groups.flatMap(g=>g.words),deck.words);
});

test('every basic word has the PDF phonetic/meaning, a real detail shard, and searchable tags',()=>{
  const source=read('data/basic-level1-2.json');
  const map=read('vocab-index/shard-map.json').words;
  const quick=read('vocab-index/word-quick.json').words;
  const index=read('vocab-index.json').entries;
  const shards=new Map();
  for(const e of source.entries){
    const key=e.word.toLowerCase(),id=map[key];
    assert.ok(id,`missing shard: ${key}`);
    if(!shards.has(id)) shards.set(id,read(`vocab-index/lexemes-${id}.json`).words);
    const entry=shards.get(id).find(x=>x.word.toLowerCase()===key);
    assert.deepEqual(entry.basic.translation,[e.definition]);
    assert.equal(entry.basic.phonetic,e.phonetic);
    assert.deepEqual(entry.basic.examples,e.examples);
    assert.ok(quick[key].includes('零基础'));
    assert.ok(index[key][3].includes('零基础'));
  }
});

test('material cards keep legacy IDs after inserting missing PDF words',()=>{
  const window={};
  vm.runInNewContext(fs.readFileSync(path.join(root,'deck-data.js'),'utf8'),{window});
  const text=fs.readFileSync(path.join(root,'materials/0基础/Level 1-2/零基础词汇讲义Level1-2_词汇表.csv'),'utf8');
  const cards=window.IballDeck.parseDeck(text,{id:'basic',format:'csv'},0);
  const source=read('data/basic-level1-2.json').entries;
  assert.equal(cards.length,1440);
  cards.forEach((card,i)=>{
    assert.equal(card.phrase,source[i].word);
    assert.equal(card.id,`basic:1:${source[i].legacyId}`);
    assert.ok(card.meaning.includes(source[i].definition));
  });
  assert.equal(new Set(cards.map(c=>c.id)).size,1440);
});

test('recite status/export/import stays keyed by word across order changes and reloads',()=>{
  const store=new Map();
  const localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};
  const load=()=>{
    const window={localStorage,addEventListener(){},dispatchEvent(){}};
    vm.runInNewContext(fs.readFileSync(path.join(root,'vocab-recite-api.js'),'utf8'),{window,CustomEvent:class{},Date,console});
    return window.IballVocabRecite;
  };
  const api=load();
  for(const [word,status] of [['time','known'],['week','unknown'],['evening','fuzzy']]) api.record({deck:'basic',word,status});
  const reloaded=load();
  assert.equal(reloaded.getRecord('basic','time').status,'known');
  assert.equal(reloaded.getRecord('basic','week').status,'unknown');
  assert.equal(reloaded.getRecord('basic','evening').status,'fuzzy');
  assert.equal(reloaded.getRecords('basic').length,3);
  assert.equal(reloaded.getRecord('cet4','time'),null);
});

test('the actual account storage bridge saves a complete 1440-word learning history',()=>{
  const raw=new Map();
  const backing={get length(){return raw.size;},key:i=>[...raw.keys()][i]??null,
    getItem:k=>raw.get(k)??null,setItem:(k,v)=>raw.set(k,String(v)),removeItem:k=>raw.delete(k)};
  const window={localStorage:backing,location:{href:'http://localhost/vocab.html',pathname:'/vocab.html'},addEventListener(){}};
  const document={currentScript:null,hidden:true,addEventListener(){}};
  const context={window,document,URL,TextEncoder,Date,console,fetch:async()=>({ok:false}),setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'account-store.js'),'utf8'),context);
  vm.runInNewContext(fs.readFileSync(path.join(root,'vocab-recite-api.js'),'utf8'),context);
  const entries=read('data/basic-level1-2.json').entries;
  const at=new Date().toISOString();
  const records=Object.fromEntries(entries.map(e=>[`basic::${e.word.toLowerCase()}`,{deck:'basic',word:e.word,status:'known',reviews:1,firstAt:at,lastAt:at,source:'vocab-list:basic'}]));
  const history=entries.slice(-500).map(e=>({deck:'basic',word:e.word,status:'known',at,source:'vocab-list:basic'}));
  const value=JSON.stringify({version:1,records,history,updatedAt:at});
  assert.ok(Buffer.byteLength(value)>256*1024);
  window.localStorage.setItem('iball_vocab_recite_v1',value);
  assert.equal(window.localStorage.getItem('iball_vocab_recite_v1')?.length,value.length);
  assert.equal(Object.keys(JSON.parse(window.localStorage.getItem('iball_vocab_recite_v1')).records).length,1440);
});
