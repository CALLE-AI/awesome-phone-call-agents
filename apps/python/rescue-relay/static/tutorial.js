/* Local media and chapter data only. No analytics, network services or autoplay. */
'use strict';
(() => {
  const $=id=>document.getElementById(id), video=$('video');
  const data=window.RESCUE_WALKTHROUGH||{demo:[],full:[]};
  const files={demo:'rescue-relay-demo',full:'rescue-relay-tutorial'};
  let mode='demo';
  const clock=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
  const title=s=>s.toLowerCase().replace(/(^|[.!?]\s+)([a-z])/g,(_,p,c)=>p+c.toUpperCase());
  for (const key of ['demo','full']) {
    const list=data[key]||[];
    $(key+'Length').textContent=list.length?clock(Math.round(list.at(-1).end)):'';
  }
  function chapters() {
    const list=data[mode]||[];
    $('chapters').replaceChildren();$('transcript').replaceChildren();
    list.forEach((cue,index)=>{
      const b=document.createElement('button');b.type='button';b.className='chapter';b.dataset.index=index;b.setAttribute('aria-current','false');
      const time=document.createElement('time');time.textContent=clock(cue.start);
      const label=document.createElement('span');label.textContent=title(cue.title);
      b.append(time,label);b.addEventListener('click',()=>{video.currentTime=cue.start;video.play().catch(()=>{});});$('chapters').append(b);
      const li=document.createElement('li'),head=document.createElement('strong');head.textContent=`${clock(cue.start)} · ${title(cue.title)}`;li.append(head,document.createTextNode(cue.text));$('transcript').append(li);
    });
    update();
  }
  function update() {
    const cues=data[mode]||[];
    const active=cues.findIndex(c=>video.currentTime>=c.start&&video.currentTime<c.end);
    document.querySelectorAll('.chapter').forEach((b,i)=>b.setAttribute('aria-current',String(i===active)));
  }
  function select(key) {
    if(!files[key])return;mode=key;video.pause();$('videoError').hidden=true;
    video.src=`media/${files[key]}.mp4`;video.poster=`media/${key==='demo'?'demo':'tutorial'}-poster.jpg`;
    $('captionTrack').src=`media/${files[key]}.vtt`;
    const label=key==='demo'?'Product demo':'Full walkthrough';
    video.setAttribute('aria-label',`Rescue Relay ${label.toLowerCase()}`);
    $('playingLabel').textContent=`${label} · Caption-led, no audio`;
    $('downloadVideo').href=`media/${files[key]}.mp4`;
    document.querySelectorAll('[data-video]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.video===key)));
    video.load();chapters();
  }
  document.querySelectorAll('[data-video]').forEach(b=>b.addEventListener('click',()=>select(b.dataset.video)));
  video.addEventListener('timeupdate',update);
  video.addEventListener('error',()=>$('videoError').hidden=false);
  if(location.protocol==='file:'){
    $('openApp').href='#setup';$('openApp').textContent='Start your workspace';$('offlineNote').hidden=false;
  }
  chapters();
})();
