import test from 'node:test';
import assert from 'node:assert/strict';
import {loadLuxKnowledge, planLuxKnowledge, selectLuxSources, stripLuxAddress} from '../lib/lux/knowledge.mjs';

const catalog = [
  {slug:'lux',nameLocalizations:{ru_ru:'Люкс',en_us:'Lux'}},
  {slug:'garen',nameLocalizations:{ru_ru:'Гарен',en_us:'Garen'}},
  {slug:'ahri',nameLocalizations:{ru_ru:'Ари',en_us:'Ahri'}},
];
const sources = [{url:'/winrates'}, {url:'/guides/lux'}, {url:'https://www.leagueoflegends.com/ru-ru/champions/lux/'}];

test('addressing Lux does not request champion data or carry old statistics into small talk', () => {
  for (const body of ['@Люкс, привет.', 'люкс здарова', 'Привет, Люкс!', '@lux как дела?', '@Люкс спасибо']) {
    const plan = planLuxKnowledge(body,catalog,{entities:['lux'],summary:'Играет мид, мастер'},[{body:'@Люкс покажи статистику Люкс'}]);
    assert.equal(plan.gameplay,false,body);
    assert.deepEqual(plan.query.entities,[],body);
    assert.deepEqual(selectLuxSources(body,sources),[],body);
  }
  assert.equal(stripLuxAddress('@Люкс расскажи про Люкс'), 'расскажи про Люкс');
});

test('requests retain game context, explicit champion subjects and relevant sources', () => {
  const stats = planLuxKnowledge('@Люкс какой винрейт у Ари на миде в мастере?',catalog);
  assert.equal(stats.statistics,true);assert.equal(stats.gameplay,true);
  assert.deepEqual(stats.query.entities,['ahri']);assert.equal(stats.query.rank,'masterPlus');
  assert.equal(stats.query.lane,'mid');
  assert.deepEqual(selectLuxSources('@Люкс покажи статистику Ари',sources),[sources[0]]);
  assert.deepEqual(selectLuxSources('@Люкс дай гайд на Люкс',sources),[sources[1]]);
  assert.deepEqual(selectLuxSources('@Люкс расскажи о Гарене',sources),[]);
  assert.deepEqual(planLuxKnowledge('@Люкс а у тебя какой винрейт?',catalog).query.entities,['lux']);
  const followup = planLuxKnowledge('@Люкс а на поддержке?',catalog,{entities:['ahri']},[{body:'@Люкс статистика Ари'}]);
  assert.equal(followup.gameplay,true);assert.deepEqual(followup.query.entities,['ahri']);
  assert.equal(planLuxKnowledge('@Люкс кого взять на мид?',catalog).gameplay,true);
  assert.equal(planLuxKnowledge('@Люкс как ты относишься к Гарену?',catalog).gameplay,false);
});

test('greetings load character lore but never query stats, guides or show source cards', async () => {
  const queries=[];
  const sql=(parts) => {
    if (!Array.isArray(parts) || !('raw' in parts)) return parts;
    const query=parts.join('?');queries.push(query);
    if(query.includes('from champions')) return Promise.resolve(catalog);
    if(query.includes('from champion_lore')) return Promise.resolve([{champion_slug:'lux',lore:'Люкс выросла в Демасии.',source_url:sources[2].url}]);
    throw new Error(`Unexpected lookup: ${query}`);
  };
  const result=await loadLuxKnowledge(sql,'@Люкс, привет.',{entities:['lux']},[]);
  assert.deepEqual(result.sources,[]);assert.deepEqual(result.knowledge.stats,[]);
  assert.equal(result.knowledge.notice,'');assert.equal(result.knowledge.topic,'conversation');
  assert.equal(result.knowledge.lore[0].slug,'lux');assert.equal(queries.length,2);
});
