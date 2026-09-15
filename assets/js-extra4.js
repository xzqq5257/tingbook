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
  // Safety: if core elements missing, return dummy to prevent crashes
  if(!grid){
    console.error('[ALBUM] #album-photos not found, module disabled');
    return { list: function(){ console.warn('[ALBUM] list() called but grid missing'); } };
  }
  let files = [];        // 内存中所有文件（{name,size,rawUrl,htmlUrl,type}）
  let viewIdx = -1;      // 当前查看的索引
  let isZoomed = false;

  // ---- 置顶（localStorage 持久化，本机生效）----
  var PIN_KEY = 'album_pinned_v1';
  function loadPins(){ try{ return JSON.parse(localStorage.getItem(PIN_KEY)||'[]'); }catch(e){ return []; } }
  function savePins(arr){ try{ localStorage.setItem(PIN_KEY, JSON.stringify(arr)); }catch(e){} }
  function applyPins(){
    var pins = loadPins();
    var set = {}; pins.forEach(function(n){ set[n] = 1; });
    files.forEach(function(f){ f.pinned = !!set[f.name]; });
  }
  function sortFiles(){
    // 稳定排序：置顶在前，组内保持原顺序（现代引擎 sort 稳定）
    files.sort(function(a,b){ return (b.pinned?1:0) - (a.pinned?1:0); });
  }
  function togglePin(f){
    var pins = loadPins();
    var i = pins.indexOf(f.name);
    if(i>=0){ pins.splice(i,1); f.pinned = false; }
    else { pins.push(f.name); f.pinned = true; }
    savePins(pins);
    sortFiles();
    page = 0;            // 置顶后回到第一页，让用户立刻看到效果
    render();
    setStatus(f.pinned ? ('已置顶「'+f.name+'」') : ('已取消置顶「'+f.name+'」'));
  }

  // ---- 网格分页：每页最多 9 张，翻页看其余 ----
  var PAGE_SIZE = 9;
  var page = 0;
  function totalPages(){ return Math.max(1, Math.ceil(files.length / PAGE_SIZE)); }

  function ensurePager(){
    var p = document.getElementById('album-pager');
    if(p) return p;
    p = document.createElement('div');
    p.id = 'album-pager';
    p.innerHTML = '<button type="button" id="apg-prev" aria-label="上一页">‹</button>' +
      '<span id="apg-label"></span>' +
      '<button type="button" id="apg-next" aria-label="下一页">›</button>';
    grid.parentNode.insertBefore(p, grid.nextSibling);
    document.getElementById('apg-prev').addEventListener('click', function(){ gotoPage(page-1); });
    document.getElementById('apg-next').addEventListener('click', function(){ gotoPage(page+1); });
    return p;
  }
  function gotoPage(n){
    var t = totalPages();
    page = Math.min(Math.max(n, 0), t-1);
    render();
    try{ grid.scrollIntoView({block:'start', behavior:'smooth'}); }catch(e){}
  }
  function updatePager(){
    var p = ensurePager();
    var t = totalPages();
    var show = files.length > PAGE_SIZE;
    p.style.display = show ? 'flex' : 'none';
    if(!show) return;
    var lb = document.getElementById('apg-label');
    if(lb) lb.textContent = (page+1) + ' / ' + t;
    var prev = document.getElementById('apg-prev');
    var next = document.getElementById('apg-next');
    if(prev) prev.disabled = (page<=0);
    if(next) next.disabled = (page>=t-1);
  }

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
      applyPins();
      sortFiles();
      if(page >= totalPages()) page = 0;
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
      updatePager();
      return;
    }
    var start = page * PAGE_SIZE;
    var slice = files.slice(start, start + PAGE_SIZE);
    slice.forEach((f, k) => {
      const i = start + k;   // 全局索引（查看器按 files 全序翻页）
      const cell = document.createElement('div');
      cell.className = 'album-cell' + (f.pinned ? ' pinned' : '');
      cell.dataset.idx = i;
      const typeLabel = isVid(f.name) ? '<span class="badge video">▶</span>' : '';
      const pinBadge = f.pinned ? '<span class="badge pinned">📌</span>' : '';
      const mSrc = mediaUrl(f);
      const thumbSrc = isVid(f.name) ? '' : mSrc;
      const vidFirstFrame = isVid(f.name) ? ('<video src="'+escHtml(mSrc)+'#t=0.5" muted preload="metadata" playsinline></video>') : ('<img loading="lazy" decoding="async" src="'+escHtml(thumbSrc)+'" alt="">');
      cell.innerHTML = typeLabel + pinBadge + vidFirstFrame +
        '<button class="pin" title="'+(f.pinned?'取消置顶':'置顶')+'">📌</button>' +
        '<button class="del" title="删除">×</button>';
      cell.querySelector('img,video').addEventListener('click', () => openViewer(i));
      cell.addEventListener('click', (e) => { if(!e.target.classList.contains('del') && !e.target.classList.contains('pin')) openViewer(i); });
      cell.querySelector('.del').addEventListener('click', (e) => {
        e.stopPropagation();
        if(confirm('删除「'+f.name+'」？此操作无法撤销。')) del(f);
      });
      cell.querySelector('.pin').addEventListener('click', (e) => {
        e.stopPropagation();
        togglePin(f);
      });
      grid.appendChild(cell);
    });
    grid._cachedCount = files.length;
    updatePager();
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

  // 并发上传（4 路），占位卡按 picked 下标一一对应，完成后原地变缩略图/失败
  const UPLOAD_CONCURRENCY = 4;

  fileInput.addEventListener('change', async () => {
    const picked = Array.from(fileInput.files || []);
    fileInput.value = '';
    if(!picked.length) return;
    const mediaIdx = [];
    picked.forEach((f, i) => {
      if(f.type.startsWith('image/') || f.type.startsWith('video/')) mediaIdx.push(i);
    });
    const otherList = picked.filter(f => !f.type.startsWith('image/') && !f.type.startsWith('video/'));
    if(otherList.length){
      alert('已跳过 '+otherList.length+' 个不支持的文件（仅图片和视频）');
    }
    // 占位卡：带缩略图预览，上传完移除，失败转失败态
    const placeholders = new Array(picked.length).fill(null);
    mediaIdx.forEach((i) => {
      const f = picked[i];
      const c = document.createElement('div');
      c.className = 'album-cell uploading';
      let preview = '';
      if(f.type.startsWith('image/')){
        try{ preview = '<img src="'+URL.createObjectURL(f)+'" alt="">'; }catch(e){}
      }
      c.innerHTML = preview + '<div class="name">排队中</div>';
      grid.prepend(c);
      placeholders[i] = c;
    });
    let ok = 0, fail = 0, done = 0;
    const total = mediaIdx.length;

    async function task(i){
      const f = picked[i];
      const isImg_ = f.type.startsWith('image/');
      const isVid_ = f.type.startsWith('video/');
      const limit = isImg_ ? MAX_PHOTO : MAX_VIDEO;
      const c = placeholders[i];
      if(f.size > limit){
        fail++; done++;
        if(c){ c.classList.remove('uploading'); c.classList.add('fail'); c.querySelector('.name').textContent = '超过 '+(isImg_?'15MB':'50MB'); }
        setStatus('「'+f.name+'」超过大小限制，已跳过');
        return;
      }
      try{
        if(c) c.querySelector('.name').textContent = '上传中';
        const savedFile = await uploadOne(f);
        ok++; done++;
        if(c){ c.remove(); }
        files.unshift(savedFile);
        setStatus('上传 '+done+'/'+total+'：'+f.name);
      }catch(e){
        fail++; done++;
        if(c){ c.classList.remove('uploading'); c.classList.add('fail'); c.querySelector('.name').textContent = '上传失败'; }
        setStatus('上传失败：'+f.name+' - '+e.message);
      }
    }

    // 简易工作池：UPLOAD_CONCURRENCY 个 worker 从队列里抢任务
    let cursor = 0;
    async function worker(){
      while(cursor < mediaIdx.length){
        const i = mediaIdx[cursor++];
        await task(i);
      }
    }
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, total) }, worker));

    // 统一重渲染（分页 + 排序后回到第一页，新上传的图立即可见）
    sortFiles();
    page = 0;
    render();
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

  // ============ 全屏电子画册查看器（分页显示） ============
  // 参考云展网 Metro 模板电子画册：单页满屏 + 底部工具栏 + 侧边翻页 + 缩略图抽屉
  var pager = document.getElementById('pager');
  var drawer = document.getElementById('av-drawer');
  var thumbs = document.getElementById('av-thumbs');
  var jumpPanel = document.getElementById('av-jump');
  var playTimer = null;
  var jumpTimer = null;   // 防止自动翻页读到视频时不打断

  function buildMedia(f){
    let el;
    if(isVid(f.name)){
      el = document.createElement('video');
      el.src = mediaUrl(f); el.controls = true; el.autoplay = true; el.playsInline = true;
      el.setAttribute('playsinline',''); el.setAttribute('webkit-playsinline','');
    } else {
      el = document.createElement('img');
      el.src = mediaUrl(f); el.alt = f.name;
      el.decoding = 'async';
    }
    el.className = 'av-media';
    return el;
  }

  function updatePager(){
    var total = files.length;
    if(pager) pager.textContent = total ? ((viewIdx+1) + ' / ' + total) : '0 / 0';
    var jt = document.getElementById('av-jump-total');
    if(jt) jt.textContent = total;
    var ji = document.getElementById('av-jump-input');
    if(ji) ji.max = total;
    var _p = document.getElementById('av-prev'); if(_p) _p.disabled = (viewIdx<=0);
    var _n = document.getElementById('av-next'); if(_n) _n.disabled = (viewIdx>=total-1);
    // 缩略图高亮
    if(thumbs){
      var cur = thumbs.querySelector('.av-thumb.cur');
      if(cur) cur.classList.remove('cur');
      var t = thumbs.querySelector('.av-thumb[data-idx="'+viewIdx+'"]');
      if(t){
        t.classList.add('cur');
        if(drawer && drawer.classList.contains('open')){
          var tr = t.getBoundingClientRect(), dr = drawer.getBoundingClientRect();
          if(tr.top < dr.top || tr.bottom > dr.bottom) t.scrollIntoView({block:'center'});
        }
      }
    }
  }

  function buildThumbs(){
    if(!thumbs) return;
    thumbs.innerHTML = '';
    files.forEach(function(f, i){
      var d = document.createElement('div');
      d.className = 'av-thumb'; d.dataset.idx = i;
      var inner = isVid(f.name)
        ? '<video src="'+escHtml(mediaUrl(f))+'#t=0.3" muted preload="metadata" playsinline></video>'
        : '<img loading="lazy" decoding="async" src="'+escHtml(mediaUrl(f))+'" alt="">';
      d.innerHTML = inner + '<span class="no">'+(i+1)+'</span>';
      d.addEventListener('click', function(){ gotoIdx(i); if(drawer) drawer.classList.remove('open'); });
      thumbs.appendChild(d);
    });
  }

  function gotoIdx(i, dir){
    if(i<0 || i>=files.length) return;
    var d = dir || (i > viewIdx ? 'next' : 'prev');
    viewIdx = i;
    showCurrent(d);
    updatePager();
  }

  function openViewer(idx){
    if(!files.length) return;
    viewIdx = idx;
    buildThumbs();
    showCurrent(null);
    updatePager();
    viewer.classList.add('show');
    viewer.setAttribute('aria-hidden','false');
    showHint();
  }

  function closeViewer(){
    viewer.classList.remove('show','zoomed');
    viewer.setAttribute('aria-hidden','true');
    stage.innerHTML = '';
    stage.querySelectorAll('.av-loading').forEach(function(n){ n.remove(); });
    if(drawer) drawer.classList.remove('open');
    if(jumpPanel) jumpPanel.classList.remove('open');
    stopAuto();
    viewIdx = -1; isZoomed = false;
  }

  function goPrev(){ if(files.length>1 && viewIdx>0){ viewIdx--; showCurrent('prev'); updatePager(); } }
  function goNext(){ if(files.length>1 && viewIdx<files.length-1){ viewIdx++; showCurrent('next'); updatePager(); } }

  // 图片加载中占位（实测：大图首帧会有可见空窗，需给用户反馈）
  function attachLoader(el, f){
    var box = document.createElement('div');
    box.className = 'av-loading';
    box.innerHTML = '<span class="sp"></span><span class="tx">加载中…</span>';
    stage.appendChild(box);
    var dead = false;
    var done = function(){ if(dead) return; dead = true; if(box.parentNode) box.parentNode.removeChild(box); };
    // 兜底：无论解码事件是否到达，6s 后移除指示，避免一直转圈
    var guard = setTimeout(done, 6000);
    var clear = function(){ clearTimeout(guard); done(); };
    if(el.tagName === 'IMG'){
      // 判据以 naturalWidth 为准：complete 在某些环境下始终为 false，
      // 但只要拿到像素尺寸就说明图已可用，指示应立刻撤。
      var check = function(){
        if(el.naturalWidth > 0){ clear(); return true; }
        return false;
      };
      el.addEventListener('load', clear, { once: true });
      el.addEventListener('error', function(){
        box.innerHTML = '<span class="tx err">加载失败，滑动或点两侧可重试</span>';
        clearTimeout(guard);
        setTimeout(done, 2600);
      }, { once: true });
      requestAnimationFrame(function(){ if(!check()) setTimeout(check, 120); });
      setTimeout(check, 700);
      setTimeout(check, 2000);
    } else {
      el.addEventListener('loadeddata', clear, { once: true });
      el.addEventListener('error', function(){ box.innerHTML = '<span class="tx err">视频加载失败</span>'; clearTimeout(guard); setTimeout(done, 2600); }, { once: true });
    }
    return el;
  }

  function showCurrent(dir){
    if(viewIdx < 0 || !files[viewIdx]) return;
    const f = files[viewIdx];
    var _dl = document.getElementById('av-download');
    if(_dl) _dl.onclick = () => {
      const a = document.createElement('a');
      a.href = f.rawUrl; a.download = f.name; a.target = '_blank';
      document.body.appendChild(a); a.click(); a.remove();
    };
    const incoming = buildMedia(f);
    // 上一页的加载占位先清掉，避免叠加
    stage.querySelectorAll('.av-loading').forEach(function(n){ n.remove(); });
    attachLoader(incoming, f);
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
      setTimeout(() => { if(dead.parentNode) dead.parentNode.removeChild(dead); }, 400);
    }
  }

  function showHint(){
    const h = document.getElementById('av-hint'); if(!h) return;
    h.classList.add('show'); clearTimeout(h._t);
    h._t = setTimeout(() => h.classList.remove('show'), 2600);
  }

  // ---- 自动翻页 ----
  function startAuto(){
    stopAuto();
    var btn = document.getElementById('av-play-btn');
    if(btn) btn.classList.add('on');
    playTimer = setInterval(function(){
      if(viewIdx >= files.length-1){ stopAuto(); return; }
      goNext();
    }, 4000);
  }
  function stopAuto(){
    if(playTimer){ clearInterval(playTimer); playTimer = null; }
    var btn = document.getElementById('av-play-btn');
    if(btn) btn.classList.remove('on');
  }

  // ---- 绑定工具栏 ----
  var _avClose = document.getElementById('av-close');
  var _avPrev = document.getElementById('av-prev');
  var _avNext = document.getElementById('av-next');
  if(_avClose) _avClose.addEventListener('click', closeViewer);
  if(_avPrev) _avPrev.addEventListener('click', goPrev);
  if(_avNext) _avNext.addEventListener('click', goNext);

  var _thumbBtn = document.getElementById('av-thumb-btn');
  if(_thumbBtn) _thumbBtn.addEventListener('click', function(){
    if(!drawer) return;
    buildThumbs();
    drawer.classList.toggle('open');
    if(drawer.classList.contains('open')) updatePager();
  });
  var _drawerClose = document.getElementById('av-drawer-close');
  if(_drawerClose) _drawerClose.addEventListener('click', function(){ if(drawer) drawer.classList.remove('open'); });

  var _jumpBtn = document.getElementById('av-jump-btn');
  if(_jumpBtn) _jumpBtn.addEventListener('click', function(){
    if(!jumpPanel) return;
    var ji = document.getElementById('av-jump-input');
    if(ji) ji.value = viewIdx+1;
    jumpPanel.classList.add('open');
    if(ji) { try{ ji.focus(); ji.select(); }catch(e){} }
  });
  var _jumpCancel = document.getElementById('av-jump-cancel');
  if(_jumpCancel) _jumpCancel.addEventListener('click', function(){ if(jumpPanel) jumpPanel.classList.remove('open'); });
  var _jumpGo = document.getElementById('av-jump-go');
  if(_jumpGo) _jumpGo.addEventListener('click', doJump);
  var _ji = document.getElementById('av-jump-input');
  if(_ji) _ji.addEventListener('keydown', function(e){ if(e.key==='Enter') doJump(); });
  function doJump(){
    var ji = document.getElementById('av-jump-input');
    var n = parseInt(ji && ji.value, 10);
    if(isNaN(n)) return;
    n = Math.min(Math.max(n,1), files.length);
    gotoIdx(n-1);
    if(jumpPanel) jumpPanel.classList.remove('open');
  }

  var _zoomBtn = document.getElementById('av-zoom-btn');
  if(_zoomBtn) _zoomBtn.addEventListener('click', toggleZoom);
  function toggleZoom(){
    isZoomed = !isZoomed;
    viewer.classList.toggle('zoomed', isZoomed);
    var btn = document.getElementById('av-zoom-btn');
    if(btn){ btn.classList.toggle('on', isZoomed); btn.querySelector('.lb').textContent = isZoomed ? '缩小' : '放大'; }
  }

  var _fitBtn = document.getElementById('av-fit-btn');
  if(_fitBtn) _fitBtn.addEventListener('click', function(){
    if(isZoomed) toggleZoom();
    else showHint();
  });

  var _playBtn = document.getElementById('av-play-btn');
  if(_playBtn) _playBtn.addEventListener('click', function(){
    if(playTimer) stopAuto(); else startAuto();
  });

  if(viewer) viewer.addEventListener('click', (e) => { if(e.target === viewer || e.target === stage) closeViewer(); });
  document.addEventListener('keydown', (e) => {
    if(!viewer.classList.contains('show')) return;
    if(jumpPanel && jumpPanel.classList.contains('open')){
      if(e.key === 'Escape') jumpPanel.classList.remove('open');
      return;
    }
    if(e.key === 'Escape') closeViewer();
    else if(e.key === 'ArrowLeft') goPrev();
    else if(e.key === 'ArrowRight') goNext();
    else if(e.key === 'Home') gotoIdx(0);
    else if(e.key === 'End') gotoIdx(files.length-1);
  });

  // 滑动翻页：触摸 + 鼠标拖拽（放大模式下不拦截，交给原生滚动）
  let _sx=null, _sy=null, _drag=false;
  function _down(x,y){ _sx=x; _sy=y; _drag=true; }
  function _up(x,y){
    if(!_drag || _sx===null) return;
    const dx=x-_sx, dy=y-_sy; _drag=false; _sx=_sy=null;
    if(isZoomed) return;
    if(Math.abs(dx)>50 && Math.abs(dx)>Math.abs(dy)){ dx<0 ? goNext() : goPrev(); }
  }
  if(stage){
    stage.addEventListener('touchstart', (e)=>{ if(e.touches.length===1) _down(e.touches[0].clientX, e.touches[0].clientY); }, {passive:true});
    stage.addEventListener('touchend', (e)=>{ if(e.changedTouches.length) _up(e.changedTouches[0].clientX, e.changedTouches[0].clientY); }, {passive:true});
    stage.addEventListener('pointerdown', (e)=>{ if(e.pointerType==='mouse') _down(e.clientX, e.clientY); });
    stage.addEventListener('pointerup', (e)=>{ if(e.pointerType==='mouse') _up(e.clientX, e.clientY); });
    stage.addEventListener('pointercancel', ()=>{ _drag=false; _sx=_sy=null; });
  }
  // 双击放大/缩小
  if(stage){
    var _lastTap = 0;
    stage.addEventListener('click', function(e){
      if(e.target !== stage && !e.target.classList.contains('av-media')) return;
      var now = Date.now();
      if(now - _lastTap < 300){ toggleZoom(); }
      _lastTap = now;
    });
  }

  // 每次打开相册 tab 都重新拉取，保证新上传的照片立刻可见
  var _albumTabBtn = document.querySelector('button[data-tab="album"]');
  if(_albumTabBtn) _albumTabBtn.addEventListener('click', () => { list(); });

  return { list, openViewer };
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