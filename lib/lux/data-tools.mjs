import { filterChampionsForPublicPool } from '../championPublicPool.mjs';
import { luxError } from './config.mjs';

const LANES=['all','mid','top','jungle','adc','support'];
const RANKS=['default','overall','diamondPlus','masterPlus','king','peak'];
const METRICS=['win_rate','pick_rate','ban_rate'];
const normalize=value=>String(value||'').toLowerCase().replace(/ё/g,'е').trim();
const dateText=value=>value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10);
const delta=(a,b)=>a==null||b==null ? null : Math.round((Number(a)-Number(b))*100)/100;
const nameOf=row=>row.nameLocalizations?.ru_ru||row.name||row.slug;

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
}

export function validateLookup(input) {
  const keys=['tool','champions','query','lane','rank','date','days','compareDate','metric','order','limit','showSources'];
  if(!input || typeof input!=='object' || Object.keys(input).some(key=>!keys.includes(key))) throw luxError('lux_invalid_lookup',400);
  const value={champions:[],query:'',lane:'all',rank:'default',date:'latest',days:7,compareDate:'',metric:'win_rate',order:'desc',limit:5,showSources:false,...input};
  if(!['champions','statistics','history','lore','guides'].includes(value.tool) ||
    !Array.isArray(value.champions) || value.champions.length>4 || value.champions.some(name=>typeof name!=='string'||!name.trim()||name.length>80) ||
    typeof value.query!=='string'||value.query.length>80 || !LANES.includes(value.lane)||!RANKS.includes(value.rank) ||
    !METRICS.includes(value.metric)||!['desc','asc'].includes(value.order)||typeof value.showSources!=='boolean' ||
    !Number.isInteger(value.limit)||value.limit<1||value.limit>10 || !Number.isInteger(value.days)||value.days<1||value.days>90 ||
    (value.date!=='latest'&&!validDate(value.date)) || (value.compareDate!==''&&!validDate(value.compareDate))) throw luxError('lux_invalid_lookup',400);
  return value;
}

async function optional(query) {
  try { return await query; } catch(error) { if(error.code==='42P01') return []; throw error; }
}

function resolveNames(names,catalog) {
  const slugs=[],unknown=[];
  for(const name of names) {
    const text=normalize(name);
    const match=catalog.find(row=>[row.slug,row.name,...Object.values(row.nameLocalizations||{})].some(item=>normalize(item)===text));
    if(match) slugs.push(match.slug); else unknown.push(name);
  }
  return {slugs:[...new Set(slugs)],unknown};
}

function metadata(snapshot,input) {
  return {source:'cnHistory',region:'CN',date:dateText(snapshot.stats_date),rank:input.rank==='default'?'diamondPlus':input.rank,
    rankAssumed:input.rank==='default',lane:input.lane,sampleSizeAvailable:false,
    limitations:['Нет числа матчей: нельзя оценить надёжность выборки или шанс победы конкретного игрока.']};
}

function summarizeRow(row,catalog) {
  return {slug:row.slug,name:nameOf(catalog.find(item=>item.slug===row.slug)||row),lane:row.lane,
    win_rate:row.win_rate,pick_rate:row.pick_rate,ban_rate:row.ban_rate};
}

function statsSource(data,rows) {
  const range=data.baselineDate ? `${data.baselineDate} → ${data.date}` : data.date;
  return {verifiedLookup:true,label:`Статистика CN · ${range} · ${data.rank}`,url:'/winrates',
    stats:rows.slice(0,6).map(row=>({name:row.name,lane:row.lane,winRate:row.win_rate,pickRate:row.pick_rate,banRate:row.ban_rate}))};
}

export function createLuxDataTools(sql) {
  async function snapshots(input) {
    const rows=await sql`select distinct on (stats_date) id,stats_date from champion_stats_snapshots
      where source='cnHistory' and status='completed'
      order by stats_date desc,completed_at desc nulls last,id desc limit 400`;
    const explicit=[input.date,input.compareDate].filter(validDate);
    if(explicit.length) {
      const older=await sql`select distinct on (stats_date) id,stats_date from champion_stats_snapshots
        where source='cnHistory' and status='completed' and stats_date=any(${explicit}::date[])
        order by stats_date desc,completed_at desc nulls last,id desc`;
      for(const row of older) if(!rows.some(item=>item.id===row.id)) rows.push(row);
    }
    return rows.map(row=>({...row,stats_date:dateText(row.stats_date)}));
  }
  async function rowsFor(snapshot,input,slugs) {
    // No preselected top ten: filtering and ranking cover the entire eligible pool.
    return sql`select h.slug,h.lane,h.win_rate,h.pick_rate,h.ban_rate from champion_stats_history h
      join champions c on c.slug=h.slug where h.snapshot_id=${snapshot.id}
      and h.rank=${input.rank==='default'?'diamondPlus':input.rank}
      and (${input.lane}='all' or h.lane=${input.lane})
      and (${slugs.length===0} or h.slug=any(${slugs}::text[]))
      and c.name_localizations->>'en_us' is not null order by h.slug,h.lane`;
  }
  function ordered(rows,input,metric=input.metric) {
    return [...rows].sort((a,b)=>{
      if(a[metric]==null) return b[metric]==null ? a.slug.localeCompare(b.slug) : 1;
      if(b[metric]==null) return -1;
      return (Number(a[metric])-Number(b[metric]))*(input.order==='asc'?1:-1)||a.slug.localeCompare(b.slug)||a.lane.localeCompare(b.lane);
    });
  }
  async function statistics(input,catalog,slugs,dates) {
    const snapshot=input.date==='latest'?dates[0]:dates.find(row=>row.stats_date===input.date);
    if(!snapshot) return {data:{error:'snapshot_not_found',requestedDate:input.date,availableDates:dates.slice(0,20).map(row=>row.stats_date)}};
    if(!slugs.length && input.lane==='all') return {data:{needsClarification:'lane',message:'Для рейтинга или рекомендаций уточни линию; показатели разных линий не смешиваются.'}};
    const all=await rowsFor(snapshot,input,slugs);
    const selected=slugs.length ? all : ordered(all,input).slice(0,input.limit);
    const rows=selected.map(row=>summarizeRow(row,catalog));
    const data={...metadata(snapshot,input),sort:{metric:input.metric,order:input.order},totalRows:all.length,rows,
      missing:slugs.filter(slug=>!all.some(row=>row.slug===slug)),comparisons:[]};
    for(let i=0;i<rows.length;i++) for(let j=i+1;j<rows.length;j++) {
      if(slugs.length<2||rows[i].lane!==rows[j].lane) continue;
      data.comparisons.push({a:rows[i].slug,b:rows[j].slug,lane:rows[i].lane,
        winRateDifferencePP:delta(rows[i].win_rate,rows[j].win_rate),
        pickRateDifferencePP:delta(rows[i].pick_rate,rows[j].pick_rate),banRateDifferencePP:delta(rows[i].ban_rate,rows[j].ban_rate)});
    }
    if(!rows.length) data.message='В этом срезе нет строк для заданного ранга, линии и чемпионов. Ноль не означает нулевой винрейт.';
    return {data,entities:slugs,sources:input.showSources&&rows.length?[statsSource(data,rows)]:[]};
  }
  async function history(input,catalog,slugs,dates) {
    const end=input.date==='latest'?dates[0]:dates.find(row=>row.stats_date===input.date);
    if(!end) return {data:{error:'snapshot_not_found',requestedDate:input.date,availableDates:dates.slice(0,20).map(row=>row.stats_date)}};
    if(!slugs.length&&input.lane==='all') return {data:{needsClarification:'lane',message:'Уточни линию для сравнения изменений всего пула.'}};
    const wanted=input.compareDate || new Date(Date.parse(end.stats_date)-input.days*86400000).toISOString().slice(0,10);
    let start=input.compareDate ? dates.find(row=>row.stats_date===wanted) : null;
    if(!input.compareDate) {
      const [baseline]=await sql`select id,stats_date from champion_stats_snapshots where source='cnHistory'
        and status='completed' and stats_date<=${wanted}::date order by stats_date desc,completed_at desc nulls last,id desc limit 1`;
      if(baseline) start={...baseline,stats_date:dateText(baseline.stats_date)};
    }
    if(!start||start.stats_date>=end.stats_date) return {data:{error:'baseline_not_found',date:end.stats_date,requestedBaseline:wanted,availableDates:dates.slice(0,30).map(row=>row.stats_date)}};
    const [before,after]=await Promise.all([rowsFor(start,input,slugs),rowsFor(end,input,slugs)]);
    const previous=new Map(before.map(row=>[`${row.slug}:${row.lane}`,row]));
    const combined=after.map(row=>{
      const old=previous.get(`${row.slug}:${row.lane}`);
      return {...summarizeRow(row,catalog),previous:old?summarizeRow(old,catalog):null,
        delta_win_rate:delta(row.win_rate,old?.win_rate),delta_pick_rate:delta(row.pick_rate,old?.pick_rate),delta_ban_rate:delta(row.ban_rate,old?.ban_rate)};
    });
    const rows=slugs.length?combined:ordered(combined.filter(row=>row[`delta_${input.metric}`]!=null),input,`delta_${input.metric}`).slice(0,input.limit);
    const data={...metadata(end,input),baselineDate:start.stats_date,requestedBaseline:wanted,baselineAdjusted:start.stats_date!==wanted,
      deltaUnit:'percentage_points',causality:'Сравнение дат не доказывает влияние патча.',totalCompared:combined.filter(row=>row.previous).length,rows,
      missing:slugs.filter(slug=>!after.some(row=>row.slug===slug)),missingBaseline:combined.filter(row=>!row.previous).map(row=>({slug:row.slug,lane:row.lane}))};
    return {data,entities:slugs,sources:input.showSources&&rows.length?[statsSource(data,rows)]:[]};
  }
  async function reference(input,catalog,slugs) {
    if(!slugs.length) return {data:{needsClarification:'champion',message:'Для лора или гайда нужен конкретный чемпион.'}};
    if(input.tool==='lore') {
      const rows=await optional(sql`select distinct on(champion_slug) champion_slug,left(official_lore,3000) as text,source_url
        from champion_lore where champion_slug in ${sql(slugs)} and review_status<>'rejected'
        order by champion_slug,(locale in ('ru_ru','ru-ru')) desc`);
      const sources=[];
      if(input.showSources) for(const row of rows) {
        try {const url=new URL(row.source_url);if(url.protocol==='https:'&&(url.hostname==='leagueoflegends.com'||url.hostname.endsWith('.leagueoflegends.com'))) sources.push({verifiedLookup:true,label:`Лор: ${nameOf(catalog.find(c=>c.slug===row.champion_slug))}`,url:url.href});} catch {}
      }
      return {data:{lore:rows.map(row=>({slug:row.champion_slug,text:row.text})),missing:slugs.filter(slug=>!rows.some(row=>row.champion_slug===slug))},sources,entities:slugs};
    }
    const [guides,tips]=await Promise.all([
      optional(sql`select slug from guide_summaries where slug in ${sql(slugs)}`),
      optional(sql`select champion_slug,lane,tip_text from champion_stable_tips where champion_slug in ${sql(slugs)}
        and review_status='approved' and patch_dependent=false and (lane is null or ${input.lane}='all' or lane=${input.lane}) order by id limit 8`),
    ]);
    return {data:{guides:guides.map(row=>({slug:row.slug,url:`/guides/${encodeURIComponent(row.slug)}`})),tips,
      limitation:'Содержимое полной сборки здесь не загружено: ссылка на гайд не подтверждает конкретный билд.'},entities:slugs,
      sources:input.showSources?guides.map(row=>({verifiedLookup:true,label:`Гайд: ${nameOf(catalog.find(c=>c.slug===row.slug))}`,url:`/guides/${encodeURIComponent(row.slug)}`})):[]};
  }
  return {
    async execute(raw) {
      const input=validateLookup(raw);
      const catalog=filterChampionsForPublicPool(await sql`select slug,name,name_localizations as "nameLocalizations" from champions`);
      if(input.tool==='champions') {
        const query=normalize(input.query);
        const matches=catalog.filter(row=>[row.slug,row.name,...Object.values(row.nameLocalizations||{})].some(name=>normalize(name).includes(query)));
        return {data:{champions:matches.slice(0,15).map(row=>({slug:row.slug,name:nameOf(row)})),total:matches.length}};
      }
      const {slugs,unknown}=resolveNames(input.champions,catalog);
      if(unknown.length) return {data:{error:'champion_not_found',unknown,message:'Уточни написание через champions; не заменяй запрошенного чемпиона лидером рейтинга.'}};
      if(input.tool==='lore'||input.tool==='guides') return reference(input,catalog,slugs);
      const dates=await snapshots(input);
      return input.tool==='history'?history(input,catalog,slugs,dates):statistics(input,catalog,slugs,dates);
    },
  };
}
