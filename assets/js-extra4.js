// ==================== 相册模块 ====================
// 数据后端：Cloudflare Functions（/api/album-list, /api/album-upload, /api/album-delete）
// 文件落地：GitHub 仓库 xzqq5257/tingbook 的 photos/ 目录（raw.githubusercontent.com 直接出图，Pages 静态也能命中）
const ALBUM = (function(){
  const MAX_PHOTO = 15 * 1024 * 1024;   // 15 MB
  const MAX_VIDEO = 50 * 1024 * 1024;   // 50 MB
  var grid = document.getElementById('album-photos');
  var fileInput = document.getElementById('album-file');
  var status = document.getElementById('album-status');
  var viewer = document.getElementById('album-viewer');
  var stage = document.getElementById('av-stage');
  var avCounter = document.getElementById('av-counter');
  // Safety: if core elements missing, return dummy to prevent crashes
  if(!grid){
    console.error('[ALBUM] #album-photos not found, module disabled');
    return { list: function(){ console.warn('[ALBUM] list() called but grid missing'); } };
  }
  let files = [];        // 内存中所有文件（{name,size,rawUrl,htmlUrl,type}）
  let viewIdx = -1;      // 当前查看的索引
  let isZoomed = false;

  function fmtSize(n){
    if(n<1024) return n+'B';
    if(n<1024*1024) return (n/1024).toFixed(1)+'KB';
    return (n/1024/1024).toFixed(2)+'MB';
  }
  function escHtml(s){return (s||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  // 出图/播放统一走本站代理（Cloudflare CDN 长缓存），失败再回退 GitHub raw。
  // 之前直连 raw.githubusercontent.com 在国内会超时/断连（实测单张 >50s）。
  function mediaUrl(f){
    if(!f) return '';
    return f.proxyUrl || f.rawUrl || '';
  }
  function setStatus(text){ if(status) status.textContent = text; }

  function isImg(name){ return /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(name); }
  function isVid(name){ return /\.(mp4|webm|mov|m4v|3gp)$/i.test(name); }

  async function list(){
    setStatus('加载中…');
    grid.innerHTML = '';
    if(!navigator.onLine){
      setStatus('离线：请检查网络后点击相册 tab 重试');
      return;
    }
    try{
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const r = await fetch('/api/album-list?_=' + Date.now(), {signal: ctrl.signal});
      clearTimeout(timer);
      const j = await r.json().catch(() => ({}));
      if(!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
      files = j.files || [];
      render();
      setStatus(files.length ? ('共 ' + files.length + ' 项') : '照片/视频会保存在你自己的 GitHub 仓库');
    }catch(e){
      const msg = (e && e.name === 'AbortError') ? '请求超时（15s）' : (e && e.message) || '未知错误';
      setStatus('加载失败：' + msg + '（可再次点击相册 tab 重试）');
      grid.innerHTML = '';
      render();
    }
  }

  function render(){
    grid.innerHTML = '';
    if(!files.length){
      const empty = document.createElement('div');
      empty.className = 'album-empty';
      empty.textContent = '还没有照片或视频。点上方「📤 上传照片/视频」按钮，或手机端点右下角 📷 悬浮按钮拍照／选图。';
      grid.appendChild(empty);
      grid._cachedCount = 0;
      return;
    }
    files.forEach((f, i) => {
      const cell = document.createElement('div');
      cell.className = 'album-cell';
      cell.dataset.idx = i;
      const typeLabel = isVid(f.name) ? '<span class="badge video">▶</span>' : '';
      const mSrc = mediaUrl(f);
      const thumbSrc = isVid(f.name) ? '' : mSrc;
      const vidFirstFrame = isVid(f.name) ? ('<video src="'+escHtml(mSrc)+'#t=0.5" muted preload="metadata" playsinline></video>') : ('<img loading="lazy" decoding="async" src="'+escHtml(thumbSrc)+'" alt="">');
      cell.innerHTML = typeLabel + vidFirstFrame +
        '<button class="del" title="删除">×</button>';
      cell.querySelector('img,video').addEventListener('click', () => openViewer(i));
      cell.addEventListener('click', (e) => { if(!e.target.classList.contains('del')) openViewer(i); });
      cell.querySelector('.del').addEventListener('click', (e) => {
        e.stopPropagation();
        if(confirm('删除「'+f.name+'」？此操作无法撤销。')) del(f);
      });
      grid.appendChild(cell);
    });
    grid._cachedCount = files.length;
  }

  // 客户端压缩大照片
  async function compressIfNeeded(file){
    if(!file.type.startsWith('image/')) return file;
    if(file.size <= 1024*1024) return file; // ≤1MB 不压
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const max = 1920;
        let w = img.width, h = img.height;
        if(Math.max(w,h) > max){
          if(w>=h){ h = Math.round(h*max/w); w = max; }
          else{ w = Math.round(w*max/h); h = max; }
        }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        c.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if(!blob){ resolve(file); return; }
          // 用 .jpg 输出（保留 png 仅在原图 ≤300KB 时），否则 JPEG 85%
          const ext = (blob.type==='image/png' && file.size < 300*1024) ? 'png' : 'jpg';
          const renamed = new File([blob], file.name.replace(/\.[^.]+$/, '') + (ext==='png'?'.png':'.jpg'), {type: blob.type});
          resolve(renamed);
        }, ext==='png' ? 'image/png' : 'image/jpeg', ext==='png' ? undefined : 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  async function uploadOne(file){
    let blob;
    if(file.type.startsWith('image/')){
      const result = await compressIfNeeded(file);
      blob = result;
    } else {
      blob = file;
    }
    const fd = new FormData();
    fd.append('file', blob, file.name);
    const r = await fetch('/api/album-upload', { method: 'POST', body: fd });
    const j = await r.json().catch(()=>({}));
    if(!r.ok || !j.ok){ throw new Error(j.error || ('HTTP '+r.status)); }
    return j.file;
  }

  fileInput.addEventListener('change', async () => {
    const picked = Array.from(fileInput.files || []);
    fileInput.value = '';
    if(!picked.length) return;
    const photoList = picked.filter(f => f.type.startsWith('image/'));
    const videoList = picked.filter(f => f.type.startsWith('video/'));
    const otherList = picked.filter(f => !f.type.startsWith('image/') && !f.type.startsWith('video/'));
    if(otherList.length){
      alert('已跳过 '+otherList.length+' 个不支持的文件（仅图片和视频）');
    }
    // 在网格头部加占位 cell
    const placeholders = [];
    picked.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/')).forEach(() => {
      const c = document.createElement('div');
      c.className = 'album-cell uploading';
      c.innerHTML = '<div class="name">上传中</div>';
      grid.prepend(c);
      placeholders.push(c);
    });
    let ok = 0, fail = 0;
    let i = 0;
    for(const f of picked){
      const isImg_ = f.type.startsWith('image/');
      const isVid_ = f.type.startsWith('video/');
      if(!isImg_ && !isVid_) { i++; continue; }
      const limit = isImg_ ? MAX_PHOTO : MAX_VIDEO;
      if(f.size > limit){
        fail++;
        const c = placeholders[i];
        if(c){ c.classList.remove('uploading'); c.classList.add('fail'); c.querySelector('.name').textContent = '超过 '+(isImg_?'15MB':'50MB'); }
        setStatus('「'+f.name+'」超过大小限制，已跳过');
        i++;
        continue;
      }
      const c = placeholders[i];
      try{
        setStatus('上传 '+(ok+fail+1)+'/'+picked.length+'：'+f.name);
        const savedFile = await uploadOne(f);
        ok++;
        if(c){ c.remove(); }
        files.unshift(savedFile);
        const cell = createCell(savedFile, 0);
        grid.prepend(cell);
      }catch(e){
        fail++;
        if(c){ c.classList.remove('uploading'); c.classList.add('fail'); c.querySelector('.name').textContent = '上传失败'; }
        setStatus('上传失败：'+f.name+' - '+e.message);
      }
      i++;
    }
    setStatus('完成：成功 '+ok+'，失败 '+fail);
  });

  // 手机端悬浮按钮复用同一文件选择器（点击即唤起系统相机/相册）
  const fab = document.getElementById('album-fab');
  if(fab) fab.addEventListener('click', () => { try{ fileInput.click(); }catch(e){} });

  function createCell(f, idx){
    const cell = document.createElement('div');
    cell.className = 'album-cell';
    cell.dataset.idx = idx;
    const typeLabel = isVid(f.name) ? '<span class="badge video">▶</span>' : '';
    if(isVid(f.name)){
      cell.innerHTML = typeLabel + '<video src="'+escHtml(mediaUrl(f))+'#t=0.5" muted preload="metadata" playsinline></video>' +
        '<button class="del" title="删除">×</button>';
    } else {
      cell.innerHTML = typeLabel + '<img loading="lazy" decoding="async" src="'+escHtml(mediaUrl(f))+'" alt="">' +
        '<button class="del" title="删除">×</button>';
    }
    cell.addEventListener('click', (e) => {
      if(e.target.classList.contains('del')) return;
      openViewer(idx);
    });
    cell.querySelector('.del').addEventListener('click', (e) => {
      e.stopPropagation();
      if(confirm('删除「'+f.name+'」？此操作无法撤销。')) del(f);
    });
    return cell;
  }

  async function del(f){
    setStatus('删除 '+f.name+'…');
    try{
      const r = await fetch('/api/album-delete?_=' + Date.now(), { method: 'DELETE', headers: {'content-type':'application/json'}, body: JSON.stringify({path: f.path, sha: f.sha, message: 'chore: delete '+f.name}) });
      const j = await r.json().catch(()=>({}));
      if(!r.ok || !j.ok){ throw new Error(j.error || ('HTTP '+r.status)); }
      setStatus('已删除 '+f.name);
      // 本地移除
      const idx = files.indexOf(f);
      if(idx>=0){ files.splice(idx,1); }
      await list();
    }catch(e){
      setStatus('删除失败：'+e.message);
    }
  }

  // 全屏画廊查看器（书籍翻页 / 滑动翻页）
  function buildMedia(f){
    let el;
    if(isVid(f.name)){
      el = document.createElement('video');
      el.src = mediaUrl(f); el.controls = true; el.autoplay = true; el.playsInline = true;
      el.setAttribute('playsinline',''); el.setAttribute('webkit-playsinline','');
    } else {
      el = document.createElement('img');
      el.src = mediaUrl(f); el.alt = f.name;
    }
    el.className = 'av-media';
    return el;
  }
  function openViewer(idx){
    if(!files.length) return;
    viewIdx = idx;
    showCurrent(null);
    viewer.classList.add('show');
    viewer.setAttribute('aria-hidden','false');
    showHint();
  }
  function closeViewer(){
    viewer.classList.remove('show');
    viewer.setAttribute('aria-hidden','true');
    stage.innerHTML = '';
    viewIdx = -1; isZoomed = false;
  }
  function goPrev(){ if(files.length>1){ viewIdx = (viewIdx - 1 + files.length) % files.length; showCurrent('prev'); } }
  function goNext(){ if(files.length>1){ viewIdx = (viewIdx + 1) % files.length; showCurrent('next'); } }
  function showCurrent(dir){
    if(viewIdx < 0 || !files[viewIdx]) return;
    const f = files[viewIdx];
    const total = files.length;
    if(avCounter) avCounter.textContent = (viewIdx+1) + ' / ' + total;
    const single = (total<=1);
    var _p = document.getElementById('av-prev'); if(_p) _p.disabled = single;
    var _n = document.getElementById('av-next'); if(_n) _n.disabled = single;
    var _dl = document.getElementById('av-download');
    if(_dl) _dl.onclick = () => {
      const a = document.createElement('a');
      a.href = f.rawUrl; a.download = f.name; a.target = '_blank';
      document.body.appendChild(a); a.click(); a.remove();
    };
    const incoming = buildMedia(f);
    incoming.classList.add('incoming');
    if(dir==='next') incoming.classList.add('from-right');
    else if(dir==='prev') incoming.classList.add('from-left');
    stage.appendChild(incoming);
    const outgoing = stage.querySelector('.av-media:not(.incoming)');
    void incoming.offsetWidth;
    incoming.classList.remove('from-right','from-left','incoming');
    if(outgoing){
      outgoing.classList.add(dir==='next' ? 'to-left' : 'to-right');
      const dead = outgoing;
      setTimeout(() => { if(dead.parentNode) dead.parentNode.removeChild(dead); }, 380);
    }
  }
  function showHint(){
    const h = document.getElementById('av-hint'); if(!h) return;
    h.classList.add('show'); clearTimeout(h._t);
    h._t = setTimeout(() => h.classList.remove('show'), 2400);
  }
  var _avClose = document.getElementById('av-close');
  var _avPrev = document.getElementById('av-prev');
  var _avNext = document.getElementById('av-next');
  if(_avClose) _avClose.addEventListener('click', closeViewer);
  if(_avPrev) _avPrev.addEventListener('click', goPrev);
  if(_avNext) _avNext.addEventListener('click', goNext);
  if(viewer) viewer.addEventListener('click', (e) => { if(e.target === viewer) closeViewer(); });
  document.addEventListener('keydown', (e) => {
    if(!viewer.classList.contains('show')) return;
    if(e.key === 'Escape') closeViewer();
    else if(e.key === 'ArrowLeft') goPrev();
    else if(e.key === 'ArrowRight') goNext();
  });
  // 滑动翻页：触摸 + 鼠标拖拽
  let _sx=null, _sy=null, _drag=false;
  function _down(x,y){ _sx=x; _sy=y; _drag=true; }
  function _up(x,y){
    if(!_drag || _sx===null) return;
    const dx=x-_sx, dy=y-_sy; _drag=false; _sx=_sy=null;
    if(Math.abs(dx)>50 && Math.abs(dx)>Math.abs(dy)){ dx<0 ? goNext() : goPrev(); }
  }
  if(stage){
    stage.addEventListener('touchstart', (e)=>{ if(e.touches.length===1) _down(e.touches[0].clientX, e.touches[0].clientY); }, {passive:true});
    stage.addEventListener('touchend', (e)=>{ if(e.changedTouches.length) _up(e.changedTouches[0].clientX, e.changedTouches[0].clientY); }, {passive:true});
    stage.addEventListener('pointerdown', (e)=>{ if(e.pointerType==='mouse') _down(e.clientX, e.clientY); });
    stage.addEventListener('pointerup', (e)=>{ if(e.pointerType==='mouse') _up(e.clientX, e.clientY); });
    stage.addEventListener('pointercancel', ()=>{ _drag=false; _sx=_sy=null; });
  }

  // 每次打开相册 tab 都重新拉取，保证新上传的照片立刻可见
  var _albumTabBtn = document.querySelector('button[data-tab="album"]');
  if(_albumTabBtn) _albumTabBtn.addEventListener('click', () => { list(); });

  return { list };
})();

// 首次进站：如果 saved tab 或 hash 指向 album，自动加载
(function(){
  function _autoList(){
    try{ ALBUM.list(); }catch(e){ console.error('[ALBUM] auto list failed:', e); }
    try{ history.replaceState(null,'', location.pathname); }catch(e){}
  }
  if(location.hash === '#album'){
    setTimeout(_autoList, 200);
  } else {
    var savedTab = '';
    try{ savedTab = localStorage.getItem('tb_tab') || ''; }catch(e){}
    if(savedTab === 'album'){
      setTimeout(_autoList, 200);
    }
  }
})();