import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Apply the verified handout after either dictionary rebuild, without replacing exam definitions. */
export async function syncBasicHandout(root) {
  const read = async (name) => JSON.parse(await fs.readFile(path.join(root, name), 'utf8'));
  const write = async (name, value) => {
    const text = JSON.stringify(value);
    const target = path.join(root, name);
    if (await fs.readFile(target, 'utf8').catch(() => '') !== text) await fs.writeFile(target, text);
  };
  const source = await read('data/basic-level1-2.json');
  const entries = source.entries;
  if (entries.length !== 1440 || new Set(entries.map(e => e.word.toLowerCase())).size !== 1440) {
    throw new Error('零基础讲义必须有 1440 个不重复词条');
  }
  const title = '零基础词汇讲义 Level 1–2';
  const words = entries.map(e => e.word);
  const keys = new Set(words.map(w=>w.toLowerCase()));
  const groups = [];
  for (const entry of entries) {
    const id = `L${entry.level}-day-${entry.day}`;
    if (groups.at(-1)?.id !== id) groups.push({ id, label: `Level ${entry.level} · Day ${entry.day}`, words: [] });
    groups.at(-1).words.push(entry.word);
  }
  if (groups.length !== 36 || groups.some(g => g.words.length !== 40)) throw new Error('讲义 Day 分组不完整');
  await write('vocab-index/deck-basic.json', {
    deck: 'basic', label: '零基础', title, provenance: source.provenance, words, groups,
    entries: entries.map(e => [e.word, e.phonetic, e.definition]),
  });
  const csv = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = [['序号','单词','音标','词性','中文释义','英文例句','分类','小节','卡片ID'],
    ...entries.map((e,i) => [i+1,e.word,e.phonetic,'',e.definition,e.examples.join(' | '),`Level ${e.level}`,`Day ${e.day}`,e.legacyId])];
  await fs.writeFile(path.join(root,'materials/0基础/Level 1-2/零基础词汇讲义Level1-2_词汇表.csv'), rows.map(r=>r.map(csv).join(',')).join('\n')+'\n');

  const map = (await read('vocab-index/shard-map.json')).words;
  const shards = new Map();
  const quick = await read('vocab-index/word-quick.json');
  const index = await read('vocab-index.json');
  const addTag = (tags) => tags.includes('零基础') ? tags : [...tags,'零基础'];
  for (const entry of entries) {
    const key = entry.word.toLowerCase();
    const id = map[key];
    if (!id) throw new Error(`缺少词卡分片：${key}`);
    if (!shards.has(id)) shards.set(id, await read(`vocab-index/lexemes-${id}.json`));
    const lexeme = shards.get(id).words.find(e => e.word.toLowerCase() === key);
    if (!lexeme) throw new Error(`分片映射错误：${key}`);
    lexeme.tags = addTag(lexeme.tags || []);
    lexeme.basic = { phonetic: entry.phonetic, translation: [entry.definition], examples: entry.examples,
      group: `Level ${entry.level} · Day ${entry.day}`, headword: entry.headword };
    const raw = quick.words[key]?.split('\t') || [entry.phonetic,entry.definition,''];
    raw[2] = addTag((raw[2] || '').split(' ').filter(Boolean)).join(' ');
    quick.words[key] = raw.join('\t');
    const old = index.entries[key] || [entry.word,entry.phonetic,entry.definition,'','word'];
    old[3] = addTag(old[3].split(/\s*·\s*/).filter(Boolean)).join(' · ');
    index.entries[key] = old;
  }
  for (const [id,shard] of shards) await write(`vocab-index/lexemes-${id}.json`,shard);
  await write('vocab-index/word-quick.json',quick);
  await write('vocab-index.json',index);
  await write('vocab-index/vocab-index.json',index);
  const manifest = await read('vocab-index/lexemes.json');
  const basic = manifest.decks.find(d=>d.deck==='basic');
  const cards = [...shards.values()].flatMap(s=>s.words).filter(e=>keys.has(e.word.toLowerCase()));
  Object.assign(basic, {title, words: entries.length, withPhonetic: entries.filter(e=>e.phonetic).length,
    withExample: cards.filter(e=>e.basic.examples.length || e.example).length,
    withWordroot: cards.filter(e=>e.wordroot).length, withResemble: cards.filter(e=>e.resemble).length,
    coverage: [...shards].map(([id,s])=>({shard:id,hits:s.words.filter(e=>keys.has(e.word.toLowerCase())).length,total:s.words.length})).sort((a,b)=>a.shard-b.shard) });
  await write('vocab-index/lexemes.json',manifest);
  console.log('零基础讲义：1440 词 / 36 Day，原卡片 ID 已保留');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await syncBasicHandout(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
}
