const chapters=[
{name:'The arrival',time:0,kicker:'Sales leadership · Real estate teams',headline:'Know who needs you.<br>Know how to help.',description:'Hands-on growth strategy, sales leadership, and operations for real estate teams. Eric and Adam work alongside your leadership—with TRU HQ supporting the work.',points:[]},
{name:'Pulse',time:2.8,kicker:'Pulse · Know what needs attention',headline:'The numbers that<br>need you now.',description:'You have plenty of data. The challenge is knowing where to act. Pulse brings the key numbers into focus so you can see who needs help and where execution is slipping.',points:['How many leads does an agent need to get a closing?','How many offers are going out?','Which leads are uncontacted or not being worked effectively?']},
{name:'Coach',time:7.4,kicker:'Coach · Understand your people',headline:'Know the person.<br>Know what to coach.',description:'A number can show you a problem. It cannot tell you how to help that person. Coach connects personality insights with evidence from agent conversations to give your coaching a specific focus.',points:['Understand how each agent communicates and needs support.','See the conversations behind the coaching recommendation.','Identify the skills the agent needs to improve.']},
{name:'Rep',time:21.4,kicker:'Rep · Build readiness through practice',headline:'Turn the coaching<br>into capability.',description:'Knowing what to improve is the start. Rep brings training and practice together to help agents launch into Zillow Preferred prepared—and keep developing after they begin.',points:['Build a clear foundation before the first lead.','Practice the skills identified through coaching.','Connect onboarding, training, and ongoing development.']}];
const $=s=>document.querySelector(s),film=$('#film'),stage=$('#stage');let current=0,target=1,loading=null,ready=false,selection=0;
function labels(){const label=current===3?'Walk the brokerage again':'Continue to '+chapters[current+1].name;$('#walk-label').textContent=current===0?'Walk the brokerage':label;$('#motion').textContent=current===0?'Play walkthrough':label}
function copy(i){current=i;const c=chapters[i];$('#chapter-label').textContent=c.name;$('#kicker').textContent=c.kicker;$('#headline').innerHTML=c.headline;$('#description').textContent=c.description;$('#room-points').replaceChildren(...c.points.map(t=>{const li=document.createElement('li');li.textContent=t;return li}));stage.classList.toggle('in-room',i>0);document.querySelectorAll('[data-chapter]').forEach(b=>{const yes=+b.dataset.chapter===i;b.classList.toggle('active',yes);b.setAttribute('aria-pressed',String(yes))});labels()}
async function load(){
 if(ready)return;if(loading)return loading;
 loading=(async()=>{try{
  $('#quality').disabled=true;$('#retry').hidden=true;$('#progress').hidden=true;$('#status').textContent='Preparing your walkthrough…';
  const response=await fetch($('#quality').value==='240'?'../film-240.json':'../film.json',{cache:'no-store'});
  if(!response.ok)throw Error('Manifest unavailable');
  const manifest=await response.json();
  if(manifest.parts.length!==1)throw Error('Unsupported video source');
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>finish(Error('Video load timed out')),45000);
   function cleanup(){clearTimeout(timer);film.removeEventListener('canplay',loaded);film.removeEventListener('error',failed)}
   function finish(error){cleanup();error?reject(error):resolve()}
   function loaded(){finish()};function failed(){finish(Error('Video unavailable'))}
   film.addEventListener('canplay',loaded,{once:true});film.addEventListener('error',failed,{once:true});
   film.preload='auto';film.src=manifest.parts[0];film.load();
  });
  ready=true;$('#motion').disabled=false;$('#status').textContent='Ready when you are.';
 }catch(e){$('#status').textContent='Could not load this version. Retry or select 60 fps compatibility.';$('#retry').hidden=false;throw e}
 finally{$('#quality').disabled=false;loading=null}})();return loading;
}

async function play(){const request=++selection;try{await load();if(request!==selection)return;if(current===3){film.currentTime=0;copy(0)}target=current+1;await film.play()}catch{if(ready)$('#status').textContent='Ready. Tap Continue to begin.'}}
function toggle(){if(film.paused)play();else film.pause()}
$('#walk').onclick=toggle;$('#retry').onclick=play;$('#motion').onclick=toggle;
film.addEventListener('play',()=>{stage.classList.add('playing');$('#motion').textContent='Pause';$('#walk-label').textContent='Pause walkthrough';$('#status').textContent=''});
film.addEventListener('pause',()=>{stage.classList.remove('playing');labels()});
function checkpoint(){if(!film.paused&&film.currentTime>=chapters[target].time){film.pause();copy(target);$('#status').textContent=target===3?'Explore how we work below, or replay the walkthrough.':'Take your time. Continue when you’re ready.';}}
film.addEventListener('timeupdate',checkpoint);
if('requestVideoFrameCallback' in film){const tick=()=>{checkpoint();film.requestVideoFrameCallback(tick)};film.requestVideoFrameCallback(tick)}
film.addEventListener('ended',()=>{copy(3);stage.classList.remove('playing')});
document.querySelectorAll('[data-chapter]').forEach(b=>b.onclick=async()=>{const id=++selection;film.pause();try{await load();if(id!==selection)return;const i=+b.dataset.chapter;film.currentTime=chapters[i].time;copy(i);target=Math.min(i+1,3);$('#status').textContent=i?'Take your time. Continue when you’re ready.':'Press play to enter.'}catch{}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)film.pause()});
new IntersectionObserver(([entry])=>{if(!entry.isIntersecting)film.pause()},{threshold:.05}).observe(stage);
$('#quality').onchange=()=>{++selection;film.pause();ready=false;film.removeAttribute('src');film.load();copy(0);target=1;$('#motion').disabled=true;$('#status').textContent='Press play to load the selected version.';$('#retry').hidden=true;};
film.addEventListener('waiting',()=>{if(ready&&!film.paused)$('#status').textContent='Buffering the walkthrough…'});
film.addEventListener('playing',()=>{$('#status').textContent=''});
