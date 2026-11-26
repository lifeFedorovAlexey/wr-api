'use strict';
const $ = id => document.getElementById(id);
const page = location.pathname.split('/').filter(Boolean)[0] || '';
const names = {stats:'CN-статистика',riftgg:'RiftGG',guides:'Гайды','patch-notes':'Патчноуты',yandex:'Яндекс',google:'Google'};
const labels = {idle:'Ожидание',running:'Выполняется',success:'Успешно',passed:'Успешно',failed:'Ошибка',interrupted:'Прерван',unfinished:'Нет итогового отчёта',unknown:'Состояние неизвестно',unconfigured:'Не подключён',warning:'Требует внимания',offline:'Остановлен',blocked:'Блокировка',not_found:'Сайт не найден',cancelled:'Отменён',stopped:'Остановлен',timed_out:'Таймаут'};
let snapshot, selectedJob = '', busy = false, receivedAt = 0;
function el(tag, text, cls) { const node=document.createElement(tag); if(text!=null)node.textContent=text; if(cls)node.className=cls; return node; }
function date(value) { return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(value)) : '—'; }
function duration(row) { if(!row.started_at)return '—'; const ms=Date.parse(row.finished_at || snapshot.serverAt)-Date.parse(row.started_at); if(!Number.isFinite(ms))return '—'; const s=Math.max(0,Math.floor(ms/1000)); return s>=60 ? `${Math.floor(s/60)} мин ${s%60} с` : `${s} с`; }
function badge(state) { const kind=['idle','running','success','passed'].includes(state)?'good':['failed','interrupted','offline','timed_out'].includes(state)?'bad':['warning','blocked','not_found'].includes(state)?'warn':'neutral';return el('span',labels[state]||state,'pill '+kind); }
function fact(label,value) { const node=el('div'); node.append(el('span',label,'label'),el('div',value??'—','value')); return node; }
function recent(service) { return service.lastRun || service.history?.[0]; }
function lastSuccess(service) { return service.history?.find(row=>['success','passed'].includes(row.status)); }
function currentTask(service) { return service.current ? names[service.current.job]||service.current.job||'Выполняется' : service.state==='unconfigured' ? 'Не подключён' : !service.fresh || service.state==='unknown' ? 'Неизвестно' : service.summary||'Нет активного запуска'; }
function observed(service) { return service.observedAt ? 'Данные получены: '+date(service.observedAt)+(service.fresh?'':' · устарели') : 'Данные ещё не получены'; }
function emptyHistory(service) { return service.fresh ? 'В полученной истории запусков этого типа нет' : 'История недоступна'; }
function displayStatus(row,service) { return row.status==='running' && (!service.fresh || !row.heartbeat_at || Date.parse(snapshot.serverAt)-Date.parse(row.heartbeat_at)>=90000) ? 'unknown' : row.status; }
function overview(services) {
  const cards=el('div',null,'sources-grid');
  for(const service of services){const card=el('a',null,'source-card hub-card');card.href='/'+service.id;const top=el('div',null,'source-heading');top.append(el('h2',service.title),badge(service.state));card.append(top,el('p',service.description));
    const facts=el('div',null,'facts'),last=recent(service),kind=last?names[last.job]||last.job||'Тип не записан':'—';facts.append(fact('Текущий процесс',currentTask(service)),fact('Последний запуск',date(last?.started_at)),fact('Тип · исполнитель',[kind,last?.executor].filter(Boolean).join(' · ')),fact('Результат',last ? labels[displayStatus(last,service)]||last.status:emptyHistory(service)));card.append(facts,el('div',observed(service),'source-last'));cards.append(card);}
  return cards;
}
function panel(title){const node=el('section',null,'panel hub-panel'),head=el('div',null,'section-heading');head.append(el('h2',title));node.append(head);return {node,head};}
function table(headers){const wrap=el('div',null,'table-scroll'),node=el('table'),head=el('thead'),row=el('tr'),body=el('tbody');headers.forEach(value=>row.append(el('th',value)));head.append(row);node.append(head,body);wrap.append(node);return {wrap,body};}
function assistantPanel(data) {
  const box=panel('Тексты Люкс');box.head.append(badge(data.state));
  const run=data.current,last=data.lastSuccessfulSync,attempt=run||data.lastObservedAttempt||data.history?.[0];
  const phases={loading:'Загрузка модели','loading-data':'Получение данных',generating:'Генерация',importing:'Импорт',verifying:'Проверка текстов',cleanup:'Освобождение ресурсов'};
  const facts=el('div',null,'summary');
  const progress=attempt ? `${attempt.accepted||0} / ${attempt.total??'неизвестно'}` : 'Ещё не запускался';
  const next=run ? 'После текущего запуска' : data.nextAt && Date.parse(data.nextAt)<=Date.parse(snapshot.serverAt) ? 'Ожидает исполнителя · запуск с догоном' : date(data.nextAt);
  const step=run?`${phases[run.phase]||run.phase}${run.phase==='generating'?` · ${run.generated||0} / ${run.total??'—'}`:''}`:data.fresh?'Ожидание':attempt?.status==='running'?`${phases[attempt.phase]||attempt.phase} · не подтверждён`:'Не подтверждён';
  facts.append(fact('Исполнитель',data.executor?`${data.executor} · Windows`:null),fact(data.fresh?'Текущий шаг':'Шаг по последнему сигналу',step),fact(run?'Принято в текущем запуске':attempt?.status==='running'?'Принято · последний сигнал':'Принято в последнем запуске',progress),fact('Модель для генерации',data.model),fact('Последний успешный импорт',date(last?.finished_at)),fact(run?'Статистика текущего запуска':'Статистика последнего успеха',(run||last)?.statsDate),fact('Следующий запуск · 06:30 МСК',next),fact('Последний сигнал',date(data.heartbeatAt)));
  box.node.append(facts);
  for(const message of [data.notice,data.error,data.cleanupError,data.verificationError])if(message)box.node.append(el('div',message,'source-list'));
  box.node.append(el('div','Ежедневно с догоном при включении ПК. После работы освобождаются только ресурсы, запущенные импортёром.','source-list'));
  if(data.history?.length){const t=table(['Начало','Результат','Принято / всего','Длительность']);for(const row of data.history){const tr=el('tr'),result=el('td');result.append(badge(row.status));if(row.error){const details=el('details');details.dataset.runId='assistant-'+row.id;details.append(el('summary','Подробности'),el('pre',row.error));result.append(details);}tr.append(el('td',date(row.started_at)),result,el('td',`${row.accepted||0} / ${row.total??'—'}`),el('td',duration(row)));t.body.append(tr);}box.node.append(t.wrap);}
  return box.node;
}
function detail(service) {
  const wrap=el('div');
  if(service.error)wrap.append(el('div',service.error,'notice'));
  if(service.notice)wrap.append(el('div',service.notice,'notice'));
  const info=panel('Процесс');info.head.append(badge(service.state));const facts=el('div',null,'summary');
  facts.append(fact('Текущая задача',currentTask(service)),fact('Текущий шаг',service.current?.step),fact('Последний успех',date(lastSuccess(service)?.finished_at)),fact('Резерв GitHub',service.state==='unconfigured'?'Ещё не подключён':service.jobs?.length?`Порог ${service.fallbackHours} ч; точный срок — в расписании ниже`:'Нет данных'));
  info.node.append(facts);const processes=(service.processes||[]).map(unit=>`${unit.Id}: ${unit.LoadState==='not-found'?'не установлен':(unit.ActiveState||'unknown')+' / '+(unit.SubState||'—')}`);info.node.append(el('div',[observed(service),...processes].join(' · '),'source-list'));wrap.append(info.node);
  if(service.assistant)wrap.append(assistantPanel(service.assistant));
  if(service.jobs?.length){const jobs=panel('Расписание и состояние задач'),t=table(['Тип','Последний успех','Следующий по расписанию','Резерв доступен с','Исполнитель']);
    for(const job of service.jobs){const row=el('tr');[job.title,date(job.last_success_at),date(job.nextAt),job.reason==='already-successful'?'Не требуется':job.due?'Порог превышен':date(job.fallbackAt),job.last_executor||'—'].forEach(v=>row.append(el('td',v)));t.body.append(row);}jobs.node.append(t.wrap);wrap.append(jobs.node);}
  const history=panel('История запусков');if(service.history?.length){const filter=el('select');filter.setAttribute('aria-label','Тип задачи');const all=el('option','Все типы');all.value='';filter.append(all);for(const key of [...new Set(service.history.map(row=>row.job))]){const option=el('option',names[key]||key);option.value=key;filter.append(option);}filter.value=selectedJob;filter.onchange=()=>{selectedJob=filter.value;render();};history.head.append(filter);}
  const t=table(['Начало','Тип','Исполнитель','Длительность','Результат']);
  for(const run of (service.history||[]).filter(row=>!selectedJob||row.job===selectedJob)){const row=el('tr'),result=el('td');result.append(badge(displayStatus(run,service)));if(run.result)result.append(el('div',run.result,'muted'));
    if(run.log_tail){const details=el('details');details.dataset.runId=run.id;details.append(el('summary','Подробности'),el('pre',run.log_tail));result.append(details);}if(/^https:\/\/github\.com\/lifeFedorovAlexey\/wr-api\/actions\/runs\/\d+$/.test(run.run_url||'')){const link=el('a','Открыть Actions','row-link');link.href=run.run_url;link.target='_blank';link.rel='noreferrer';result.append(link);}
    row.append(el('td',date(run.started_at)),el('td',names[run.job]||run.job),el('td',run.executor),el('td',duration(run)),result);t.body.append(row);}
  history.node.append(t.body.children.length?t.wrap:el('div',emptyHistory(service),'empty'));wrap.append(history.node);return wrap;
}
function render(){if(!snapshot)return;const services=snapshot.services;const service=services.find(s=>s.id===page);$('title').textContent=service?.title||'Все сервисы';$('description').textContent=service?.description||'Состояние процессов и последние запуски.';document.title=($('title').textContent)+' · kolvrt';
  // Keep an open log expanded while the polling refreshes the rest of the page.
  const opened=new Map([...document.querySelectorAll('details[open]')].map(node=>[node.dataset.runId,node.querySelector('pre')?.scrollTop||0]));
  $('content').replaceChildren(service?detail(service):overview(services));for(const node of document.querySelectorAll('details')){if(opened.has(node.dataset.runId)){node.open=true;node.querySelector('pre').scrollTop=opened.get(node.dataset.runId);}}$('updated').textContent='Ответ панели: '+date(snapshot.serverAt);}
async function refresh(){if(busy)return;busy=true;try{const response=await fetch('/api/status',{cache:'no-store',signal:AbortSignal.timeout(4500)});if(!response.ok)throw Error();snapshot=await response.json();receivedAt=Date.now();$('connection').textContent='Связь с панелью есть';$('connection').className='clock';render();}catch{$('connection').textContent='Нет связи · данные устарели';$('connection').className='clock error';if(snapshot){snapshot.services.forEach(service=>{service.fresh=false;service.state='unknown';service.current=null;if(service.assistant){service.assistant.lastObservedAttempt=service.assistant.current||service.assistant.lastObservedAttempt;service.assistant.fresh=false;service.assistant.state='unknown';service.assistant.current=null;service.assistant.notice='Нет связи с панелью; текущее выполнение не подтверждено.'}});render();}}finally{busy=false;}}
function tick(){ $('clock').textContent=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'}).format(new Date())+' МСК';if(receivedAt&&Date.now()-receivedAt>15000){$('connection').textContent='Нет свежих данных';$('connection').className='clock error';}}
setInterval(tick,1000);setInterval(refresh,5000);tick();refresh();
