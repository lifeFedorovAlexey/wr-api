'use strict';
const $ = id => document.getElementById(id);
const page = location.pathname.split('/').filter(Boolean)[0] || '';
const names = {stats:'CN-статистика',riftgg:'RiftGG',guides:'Гайды','patch-notes':'Патчноуты',yandex:'Яндекс',google:'Google'};
const labels = {idle:'Ожидание',running:'Выполняется',success:'Успешно',passed:'Успешно',failed:'Ошибка',interrupted:'Прерван',unknown:'Нет свежих данных',warning:'Требует внимания',offline:'Остановлен',blocked:'Блокировка',not_found:'Сайт не найден',cancelled:'Отменён',timed_out:'Таймаут'};
let snapshot, selectedJob = '', busy = false, receivedAt = 0;
function el(tag, text, cls) { const node=document.createElement(tag); if(text!=null)node.textContent=text; if(cls)node.className=cls; return node; }
function date(value) { return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(value)) : '—'; }
function duration(row) { if(!row.started_at)return '—'; const ms=Date.parse(row.finished_at || snapshot.serverAt)-Date.parse(row.started_at); if(!Number.isFinite(ms))return '—'; const s=Math.max(0,Math.floor(ms/1000)); return s>=60 ? `${Math.floor(s/60)} мин ${s%60} с` : `${s} с`; }
function badge(state) { return el('span',labels[state]||state,'badge '+(Object.hasOwn(labels,state)?state:'unknown')); }
function fact(label,value) { const node=el('div'); node.append(el('span',label,'label'),el('div',value||'—','value')); return node; }
function recent(service) { return service.history?.[0]; }
function lastSuccess(service) { return service.history?.find(row=>['success','passed'].includes(row.status)); }
function displayStatus(row,service) { return row.status==='running' && (!service.fresh || !row.heartbeat_at || Date.parse(snapshot.serverAt)-Date.parse(row.heartbeat_at)>=90000) ? 'unknown' : row.status; }
function overview(services) {
  const cards=el('div',null,'cards');
  for(const service of services){const card=el('a',null,'card');card.href='/'+service.id;const top=el('div',null,'card-top');top.append(el('h2',service.title),badge(service.state));card.append(top,el('p',service.description));
    if(service.summary){card.append(el('p',service.summary));cards.append(card);continue;}
    const facts=el('div',null,'facts'),last=recent(service);facts.append(fact('Текущий процесс',service.current ? (names[service.current.job]||service.current.job)+' · '+(service.current.step||'') : labels[service.state]),fact('Последний запуск',date(last?.started_at)),fact('Результат',last ? labels[displayStatus(last,service)]||last.status:'Запусков пока нет'),fact('Исполнитель',last?.executor||'—'));card.append(facts);cards.append(card);}
  return cards;
}
function panel(title){const node=el('section',null,'panel'),head=el('div',null,'panel-title');head.append(el('h2',title));node.append(head);return {node,head};}
function table(headers){const wrap=el('div',null,'table-scroll'),node=el('table'),head=el('thead'),row=el('tr'),body=el('tbody');headers.forEach(value=>row.append(el('th',value)));head.append(row);node.append(head,body);wrap.append(node);return {wrap,body};}
function detail(service) {
  const wrap=el('div');
  if(service.error)wrap.append(el('div',service.error,'notice'));
  if(service.notice)wrap.append(el('div',service.notice,'notice'));
  const info=panel('Процесс');info.head.append(badge(service.state));const facts=el('div',null,'summary');
  facts.append(fact('Текущая задача',service.current ? names[service.current.job]||service.current.job : 'Нет активного запуска'),fact('Текущий шаг',service.current?.step),fact('Последний успех',date(lastSuccess(service)?.finished_at)),fact(service.fallbackHours?'Резерв GitHub':'Следующий запуск',service.fallbackHours?`После ${service.fallbackHours} ч без успеха`:date(service.nextAt)));
  info.node.append(facts);const processes=(service.processes||[]).map(unit=>`${unit.Id}: ${unit.ActiveState||'unknown'} / ${unit.SubState||'—'}`);if(processes.length)info.node.append(el('div',processes.join(' · '),'source-list'));wrap.append(info.node);
  if(service.jobs?.length){const jobs=panel('Расписание и состояние задач'),t=table(['Тип','Последний успех','Следующий по расписанию','Резерв доступен с','Исполнитель']);
    for(const job of service.jobs){const row=el('tr');[job.title,date(job.last_success_at),date(job.nextAt),job.reason==='already-successful'?'Не требуется':job.due?'Порог превышен':date(job.fallbackAt),job.last_executor||'—'].forEach(v=>row.append(el('td',v)));t.body.append(row);}jobs.node.append(t.wrap);wrap.append(jobs.node);}
  const history=panel('История запусков'),filter=el('select');filter.setAttribute('aria-label','Тип задачи');const all=el('option','Все типы');all.value='';filter.append(all);for(const key of [...new Set((service.history||[]).map(row=>row.job))]){const option=el('option',names[key]||key);option.value=key;filter.append(option);}filter.value=selectedJob;filter.onchange=()=>{selectedJob=filter.value;render();};history.head.append(filter);
  const t=table(['Начало','Тип','Исполнитель','Длительность','Результат']);
  for(const run of (service.history||[]).filter(row=>!selectedJob||row.job===selectedJob)){const row=el('tr'),result=el('td');result.append(badge(displayStatus(run,service)));if(run.result)result.append(el('div',run.result,'muted'));
    if(run.log_tail){const details=el('details');details.append(el('summary','Подробности'),el('pre',run.log_tail));result.append(details);}if(/^https:\/\/github\.com\/lifeFedorovAlexey\/wr-api\/actions\/runs\/\d+$/.test(run.run_url||'')){const link=el('a','Открыть Actions','row-link');link.href=run.run_url;link.target='_blank';link.rel='noreferrer';result.append(link);}
    row.append(el('td',date(run.started_at)),el('td',names[run.job]||run.job),el('td',run.executor),el('td',duration(run)),result);t.body.append(row);}
  history.node.append(t.body.children.length?t.wrap:el('div','Запусков этого типа пока нет','empty'));wrap.append(history.node);return wrap;
}
function render(){if(!snapshot)return;const services=snapshot.services;const nav=$('nav');nav.replaceChildren();for(const item of [{id:'',title:'Обзор'},...services]){const link=el('a',item.title,item.id===page?'active':'');link.href='/'+item.id;nav.append(link);}const service=services.find(s=>s.id===page);$('title').textContent=service?.title||'Сборщики';$('description').textContent=service?.description||'Состояние сервисов на одном экране.';document.title=($('title').textContent)+' · kolvrt';
  // Keep an open log expanded while the polling refreshes the rest of the page.
  const opened=[...document.querySelectorAll('details')].map((node,i)=>node.open?i:-1).filter(i=>i>=0);
  $('content').replaceChildren(service?detail(service):overview(services));opened.forEach(i=>{const node=document.querySelectorAll('details')[i];if(node)node.open=true;});$('updated').textContent='Снимок: '+date(snapshot.serverAt);}
async function refresh(){if(busy)return;busy=true;try{const response=await fetch('/api/status',{cache:'no-store',signal:AbortSignal.timeout(4500)});if(!response.ok)throw Error();snapshot=await response.json();receivedAt=Date.now();$('connection').textContent='Связь с панелью есть';$('connection').className='connection';render();}catch{$('connection').textContent='Нет связи · данные устарели';$('connection').className='connection error';if(snapshot){snapshot.services.forEach(service=>{service.fresh=false;service.state='unknown';service.current=null;});render();}}finally{busy=false;}}
setInterval(()=>{if(receivedAt&&Date.now()-receivedAt>15000){$('connection').textContent='Нет свежих данных';$('connection').className='connection error';}},1000);setInterval(refresh,5000);refresh();
