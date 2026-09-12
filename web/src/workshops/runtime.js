export function allowedIndex(slides, passed, requested, preview) {
 const blocked=slides.findIndex((s,i)=>s.native==='practice'&&!passed.has(i));
 const n=!preview&&blocked>=0&&requested>blocked?blocked:requested;
 return Math.max(0,Math.min(slides.length-1,n));
}
export function mountWorkshop(root, host, data, hooks) {
const SLIDES=data.slides, HERO=data.hero, controller=new AbortController(), signal=controller.signal;
const passed=new Set();
const listen=(target,type,fn)=>target.addEventListener(type,fn,{signal});
const $=s=>root.querySelector(s);
const KEY=`tru-rep-workshop:${hooks.draftOwner||'preview'}:day${data.day}:${data.version||'v1'}`;
let saved={},storageWorks=true;
try{saved=JSON.parse(localStorage.getItem(KEY)||'{}');if(!saved||typeof saved!=='object'||Array.isArray(saved))saved={};localStorage.setItem(KEY,JSON.stringify(saved))}catch{storageWorks=false}
let index=0,caseIndex=0,objection=0,remaining=60,timerEnd=0,timerId=null;
const chapters=[...new Set(SLIDES.map(s=>s.chapter))];
const cases=data.cases || [{name:'Jordan · offer tonight',quote:'“I love the house, but I haven’t sent my bank any documents yet.”',goal:'Clarify readiness and ask permission for a useful next step.'},{name:'Morgan · already has a lender',quote:'“My bank has handled everything for years. Why would I need another conversation?”',goal:'Acknowledge the relationship. Explore whether a comparison would help.'},{name:'Alex · credit concern',quote:'“I’m not letting anyone run my credit until I understand what happens.”',goal:'Respect the concern. Ask the loan officer to explain the process; make no blanket promise.'}];
const objections=[{ask:'“What do you like about working with them, and is there anything you still want clarity on?”',reply:'“If a second perspective would be useful, I can introduce a loan officer at Zillow Home Loans. You choose who you work with.”',debrief:'If the buyer wants to compare offers, compare written Loan Estimates on comparable terms—not just a headline rate.',source:'https://www.consumerfinance.gov/owning-a-home/compare/'},{ask:'“Is your concern about the first step, or about what happens later in the application?”',reply:'“Pre-qualification uses a soft check. Let’s have the loan officer explain whether any later step would require a hard inquiry before you decide.”',debrief:'Do not promise that every step is free of credit impact. Let the licensed loan officer explain the actual process.'},{ask:'“What would help you feel comfortable making that decision?”',reply:'“You choose your lender. My role is to help you understand your options. An introduction is available if you want it.”',debrief:'If the buyer declines, respect it. Confirm a next step with their chosen lender rather than continuing to press.'}];
function prepareFields(container,slide){
 const normalize=text=>String(text||'').replace(/\s+/g,' ').trim();
 for(const field of slide.activity?.fields||[]){
  const existing=[...container.querySelectorAll('textarea[data-save]')].find(el=>el.dataset.save===field.id||normalize(el.closest('label')?.textContent)===normalize(field.label));
  if(existing){existing.dataset.fieldId=field.id;continue;}
  container.insertAdjacentHTML('beforeend',`<label class="field">${esc(field.label)}<textarea data-save="${esc(field.id)}" data-field-id="${esc(field.id)}"></textarea></label>`);
 }
 for(const el of container.querySelectorAll('[data-save]')){
  const oldKey=el.dataset.save,key=`${slide.id||SLIDES.indexOf(slide)}:${el.dataset.fieldId||oldKey}`;
  if(saved[key]===undefined&&saved[oldKey]!==undefined)saved[key]=saved[oldKey];
  el.dataset.save=key;
 }
}
function persist(){try{localStorage.setItem(KEY,JSON.stringify(saved))}catch{storageWorks=false}storageStatus()}
function storageStatus(){const el=$('#storage-status');if(el)el.textContent=storageWorks?'Practice notes and choices save in this browser on this device. Download a copy before sharing or moving the file.':'Browser storage is unavailable. Notes work for this session; download them before closing.'}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function say(s){$('#announcement').textContent=s}
function stopTimer(){clearInterval(timerId);timerId=null;$('#timer-toggle').textContent='Start timer'}
function render(focus=false){stopTimer();remaining=Number($('#timer-duration').value);drawClock();const s=SLIDES[index];
 $('#stage').innerHTML=`<section class="slide ${s.theme}" aria-labelledby="slide-title"><div class="meta"><span>${esc(s.chapter)} / Day ${data.day}</span><span>${s.time} min · ${String(index+1).padStart(2,'0')}</span></div><h1 id="slide-title">${s.title}</h1><p class="lead">${s.lead}</p><div class="content">${s.native?'<div id="native-slot"></div>':s.body}</div></section>`;
 if(s.theme==='hero')$('.slide').style.backgroundImage=`linear-gradient(90deg,rgba(23,29,34,.97) 0%,rgba(23,29,34,.80) 44%,rgba(23,29,34,.36) 100%),url("${HERO}")`;
 $('#cue').textContent=s.cue;$('#count').textContent=`${index+1} / ${SLIDES.length}`;$('#progress').style.width=`${(index+1)/SLIDES.length*100}%`;
 $('[data-action="prev"]').disabled=index===0;$('[data-action="next"]').disabled=!!s.native&&s.native==='practice'&&!passed.has(index)&&!hooks.preview;
 $('[data-action="next"]').textContent=index===SLIDES.length-1?(/quiz/i.test(hooks.doneLabel||'')?'Continue to quiz':hooks.doneLabel||'Finish lesson'):'→';
 $('[data-action="next"]').setAttribute('aria-label',index===SLIDES.length-1?(hooks.doneLabel||'Finish lesson'):'Next slide');
 hooks.native(s, $('#native-slot'));
 // New practice choices use stable option IDs, never certification indices.
 const choices=$('[data-quiz]');if(choices){const buttons=[...choices.querySelectorAll('button[data-option-id]')];let hash=0;for(const c of KEY+choices.dataset.quiz)hash=(hash*31+c.charCodeAt(0))>>>0;const offset=hash%Math.max(buttons.length,1);for(const b of [...buttons.slice(offset),...buttons.slice(0,offset)])choices.append(b);}
 // Reuse authored prompts and isolate repeated field IDs by stable slide ID.
 if(!s.native)prepareFields($('.content'),s);
 root.querySelectorAll('.screen-figure img:not(.details-focus img)').forEach(img=>{img.tabIndex=0;img.setAttribute('role','button');img.setAttribute('aria-label','Enlarge '+img.alt);});
 $('.chapters').innerHTML=chapters.map(c=>`<button data-go="${SLIDES.findIndex(s=>s.chapter===c)}" ${c===s.chapter?'aria-current="step"':''}>${c}</button>`).join('');
 $('#agenda-list').innerHTML=SLIDES.map((s,i)=>`<button data-go="${i}" aria-current="${i===index}"><span>${String(i+1).padStart(2,'0')}</span><span>${s.title}</span><small>${s.time} min</small></button>`).join('');
 root.querySelectorAll('[data-save]').forEach(el=>{if(el.type==='checkbox')el.checked=saved[el.dataset.save]===true;else el.value=typeof saved[el.dataset.save]==='string'?saved[el.dataset.save]:''});
 const quiz=$('[data-quiz]');if(quiz){const savedChoice=saved['quiz-'+quiz.dataset.quiz];const b=typeof savedChoice==='string'?[...quiz.querySelectorAll('button')].find(b=>b.dataset.optionId===savedChoice):Number.isInteger(savedChoice)?quiz.querySelectorAll('button')[savedChoice]:null;if(b)applyAnswer(b,false)}
 if($('#scenario'))renderCase();if($('#objection-case'))renderObjection();score();storageStatus();
 if(focus){$('#stage').focus({preventScroll:true});host.scrollIntoView({block:'start',behavior:'instant'})}say(`Slide ${index+1} of ${SLIDES.length}. ${s.title}`);
}
function go(n){const target=allowedIndex(SLIDES,passed,n,hooks.preview);index=target;render(true);if(target<n)say('Complete the record exercise before continuing.');}
function applyAnswer(button,save=true){const parent=button.closest('[data-quiz]');parent.querySelectorAll('button').forEach(b=>{b.classList.toggle('selected',b===button);b.setAttribute('aria-pressed',String(b===button))});const feedback=$('.feedback');feedback.textContent=(button.dataset.correct==='true'?'Good choice. ':'Try another approach. ')+button.dataset.feedback;if(save){saved['quiz-'+parent.dataset.quiz]=button.dataset.optionId||[...parent.querySelectorAll('button')].indexOf(button);persist()}}
function renderCase(){const c=cases[caseIndex];$('#scenario').innerHTML=`<span>Practice case ${caseIndex+1} / ${cases.length} · ${c.name}</span><blockquote>${c.quote}</blockquote><p>${c.goal}</p>`}
function renderObjection(){const o=objections[objection];$('#objection-case').innerHTML=`<h3>First, understand the concern.</h3><p>${o.ask}</p><details class="reveal"><summary>Reveal a coaching example</summary><div><blockquote>${o.reply}</blockquote><p>${o.debrief}</p>${o.source?`<a class="source" href="${o.source}" target="_blank" rel="noopener">CFPB: comparing loan offers ↗</a>`:''}</div></details>`;root.querySelectorAll('[data-objection]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.objection)===objection)))}
function score(){const el=$('#score');if(el){const items=[...root.querySelectorAll('.scorecard input')];let n=items.filter(e=>e.checked).length;el.textContent=`${n} / ${items.length} behaviors heard${n===items.length?' · Repeat with a new scenario.':''}`}}
function drawClock(){$('#clock').textContent=`${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`}
function timer(){if(timerId){remaining=Math.max(0,Math.ceil((timerEnd-Date.now())/1000));stopTimer();drawClock();return}if(remaining===0)remaining=Number($('#timer-duration').value);timerEnd=Date.now()+remaining*1000;$('#timer-toggle').textContent='Pause timer';timerId=setInterval(()=>{remaining=Math.max(0,Math.ceil((timerEnd-Date.now())/1000));drawClock();if(!remaining){stopTimer();$('#timer-toggle').textContent='Run again';say('Time is up. Give feedback, then retry.')}},200)}
function download(){const fields=new Map();const temp=document.createElement('div');for(const s of SLIDES){temp.innerHTML=s.body;prepareFields(temp,s);temp.querySelectorAll('textarea[data-save]').forEach(el=>fields.set(el.dataset.save,el.closest('label')?.textContent?.trim()||el.dataset.save));}const text=['TRU Rep | Day '+data.day+' | '+data.title,'My practice notes','',...Array.from(fields,([key,label])=>label+'\n'+(saved[key]||'(Not yet written)')+'\n'),'Practice again within 24 hours, with a new case in 3 days, and review an example with your coach in 7 days. Suggested intervals; no reminders are sent.'].join('\n');const blob=new Blob([text],{type:'text/plain;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='TRU-Day-'+data.day+'-my-practice-notes.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);say('Practice notes download requested.')}
function modal(id){const el=$(id);if(!el.open)el.showModal()}
listen(root,'input',e=>{const el=e.target;if(el.matches('[data-save]')){saved[el.dataset.save]=el.type==='checkbox'?el.checked:el.value;persist();score()}});
listen(root,'change',e=>{if(e.target.id==='timer-duration'){stopTimer();remaining=Number(e.target.value);drawClock()}});
listen(root,'click',async e=>{const b=e.target.closest('button,a.wordmark');if(!b)return;if(b.matches('a.wordmark')){e.preventDefault();go(0);return}if(b.hasAttribute('data-close')){b.closest('dialog').close();return}if(b.hasAttribute('data-go')){root.querySelectorAll('dialog[open]').forEach(d=>d.close());go(Number(b.dataset.go));return}if(b.closest('[data-quiz]')){applyAnswer(b);return}if(b.hasAttribute('data-objection')){objection=Number(b.dataset.objection);renderObjection();return}
 switch(b.dataset.action){case'prev':go(index-1);break;case'back':hooks.back();break;case'next':if(index===SLIDES.length-1)hooks.done();else go(index+1);break;case'agenda':modal('#agenda');break;case'resources':storageStatus();modal('#resources');break;case'guide':{window.open(`/workshops/day${data.day}-guide.html`,'_blank','noopener');break}case'fullscreen':try{if(document.fullscreenElement)await document.exitFullscreen();else await host.requestFullscreen()}catch{say('Full screen is unavailable in this browser. Use the browser full-screen command.')}break;case'timer':timer();break;case'reset-timer':stopTimer();remaining=Number($('#timer-duration').value);drawClock();break;case'scenario':caseIndex=(caseIndex+1)%cases.length;renderCase();break;case'clear-score':for(const el of root.querySelectorAll('.scorecard input[data-save]')){saved[el.dataset.save]=false;el.checked=false}persist();score();break;case'rate':{const val=$('#rate-answer').value;$('#rate-feedback').textContent=val!==''&&Number(val)===10?'Correct: 6 ÷ 60 × 100 = 10%.':'Divide 6 by 60, then multiply by 100. Try again.';break}case'download':download();break;case'restart':go(0);break;case'clear-notes':$('#clear-confirm').hidden=false;break;case'cancel-clear':$('#clear-confirm').hidden=true;break;case'confirm-clear':saved={};persist();$('#clear-confirm').hidden=true;render();say('Workshop notes and selections cleared.');break}
});
listen(root,'keydown',e=>{if(e.ctrlKey||e.metaKey||e.altKey||root.querySelector('dialog[open]')||e.composedPath().some(el=>el.matches?.('textarea,input,select,button,summary,a,[role="button"]')))return;if(e.key==='ArrowRight'||e.key==='PageDown'){e.preventDefault();go(index+1)}if(e.key==='ArrowLeft'||e.key==='PageUp'){e.preventDefault();go(index-1)}if(e.key==='Home'){e.preventDefault();go(0)}if(e.key==='End'){e.preventDefault();go(SLIDES.length-1)}});
listen(document,'fullscreenchange',()=>{$('[data-action="fullscreen"]').textContent=document.fullscreenElement?'Exit full screen':'Full screen'});
render();

return {pass(slide){const n=SLIDES.indexOf(slide);if(n<0)return;passed.add(n);if(n===index){$('[data-action="next"]').disabled=false;say('Record exercise passed. You can continue.');}},destroy(){controller.abort();clearInterval(timerId);hooks.native(null,null);}};
}
