/* === 三栏 Tab + 账号 + 音色仓库（听我读） === */
(function(){
  var tabs=document.querySelectorAll('#main-tabs .tab-btn');
  var panels={reading:document.getElementById('tab-reading'),music:document.getElementById('tab-music'),album:document.getElementById('tab-album'),mine:document.getElementById('tab-mine')};
  function showTab(name){
    tabs.forEach(function(b){b.classList.toggle('active',b.dataset.tab===name);});
    Object.keys(panels).forEach(function(k){if(panels[k])panels[k].classList.toggle('active',k===name);});
    try{localStorage.setItem('tb_tab',name);}catch(e){}
    if(name==='mine')refreshMine();
  }
  tabs.forEach(function(b){b.addEventListener('click',function(){showTab(b.dataset.tab);});});
  try{var t=localStorage.getItem('tb_tab');if(t&&panels[t])showTab(t);}catch(e){}

  var dash=document.getElementById('mine-dash');
  function esc(s){return (s||'').replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  // 已取消账号登录：直接展示仪表盘 + 加载音色仓库（所有访客共享）
  async function refreshMine(){
    dash.classList.remove('hidden');
    await loadVoices();
  }

  async function loadVoices(){
    var list=document.getElementById('voice-list');list.innerHTML='加载中…';
    try{
      var r=await fetch('/api/voices');var j=await r.json();
      if(!j.ok){list.innerHTML='<span class="muted">加载失败：'+(j.error||'')+'</span>';return;}
      var active=j.active;
      if(!j.voices.length){list.innerHTML='<span class="muted">还没有音色，上传一个开始吧。</span>';return;}
      list.innerHTML='';
      j.voices.forEach(function(v){
        var div=document.createElement('div');
        div.className='voice-item'+(v.id===active?' active':'');
        var label=document.createElement('span');label.style.flex='1';
        label.innerHTML='<b>'+esc(v.name)+'</b>'+(v.id===active?' <span class="muted">(默认)</span>':'');
        div.appendChild(label);
        var play=document.createElement('button');play.className='btn ghost';play.textContent='试听';
        play.onclick=async function(){var a=await fetch('/api/voice-audio?id='+encodeURIComponent(v.id));if(a.ok){var b=await a.blob();var u=URL.createObjectURL(b);(new Audio(u)).play();}};
        var set=document.createElement('button');set.className='btn';set.textContent='设为默认';
        set.onclick=async function(){await fetch('/api/voice-active',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:v.id})});loadVoices();};
        var del=document.createElement('button');del.className='btn danger';del.textContent='删除';
        del.onclick=async function(){if(confirm('确认删除音色「'+v.name+'」？')){await fetch('/api/voices?id='+encodeURIComponent(v.id),{method:'DELETE'});loadVoices();}};
        div.appendChild(play);div.appendChild(set);div.appendChild(del);
        list.appendChild(div);
      });
    }catch(e){list.innerHTML='<span class="muted">加载失败</span>';}
  }
  document.getElementById('voice-add').addEventListener('click',async function(){
    var name=document.getElementById('voice-name').value.trim();
    var file=document.getElementById('voice-file-upload').files[0];
    var refText=document.getElementById('voice-reftext').value.trim();
    var msg=document.getElementById('voice-msg');
    if(!name||!file){msg.textContent='请填写名称并选择音频';return;}
    msg.textContent='上传中…';
    var fd=new FormData();fd.append('name',name);fd.append('file',file);if(refText)fd.append('refText',refText);
    try{
      var r=await fetch('/api/voices',{method:'POST',body:fd});var j=await r.json();
      if(r.ok&&j.ok){msg.textContent='已添加';document.getElementById('voice-name').value='';document.getElementById('voice-file-upload').value='';document.getElementById('voice-reftext').value='';await loadVoices();}
      else msg.textContent=j.error||'上传失败';
    }catch(e){msg.textContent='网络错误';}
  });

  var tingStatus=document.getElementById('ting-status');
  if(tingStatus){
    fetch('/api/voice-active').then(function(r){return r.json();}).then(async function(j){
      if(j.active){try{var v=await(await fetch('/api/voices')).json();var cur=v.voices&&v.voices.find(function(x){return x.id===j.active;});if(cur)tingStatus.textContent='当前克隆音色：'+cur.name;}catch(e){}}
    }).catch(function(){});
  }
})();