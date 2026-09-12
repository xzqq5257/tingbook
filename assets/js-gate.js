(function(){
  var SITE_PASSWORD = "1396788686";
  var KEY = "ting_gate_ts";            // 解锁时间戳(ms)
  var SESSION_MS = 60 * 60 * 1000;     // 1 小时必须重新登录
  var GATE_HTML = '<div class="box">'
    + '<h1>听我读 · 私人空间</h1>'
    + '<p>请输入访问密码</p>'
    + '<input id="gatePwd" type="password" placeholder="密码" autocomplete="off">'
    + '<button id="gateBtn" type="button">进入</button>'
    + '<div class="err" id="gateErr"></div>'
    + '</div>';
  function getGate(){ return document.getElementById("siteGate"); }
  function unlocked(){
    try{
      var ts = parseInt(sessionStorage.getItem(KEY) || "0", 10);
      if(!ts) return false;
      return (Date.now() - ts) < SESSION_MS;
    }catch(e){ return false; }
  }
  function showErr(m){ var e=document.getElementById("gateErr"); if(e) e.textContent=m; }
  function reveal(){
    var g=getGate(); if(g&&g.parentNode) g.parentNode.removeChild(g);
    document.documentElement.style.overflow=""; if(document.body) document.body.style.overflow="";
  }
  function lock(){
    if(!getGate()){
      var d=document.createElement("div"); d.id="siteGate"; d.innerHTML=GATE_HTML;
      document.body.insertBefore(d, document.body.firstChild);
      bind();
    }
    document.documentElement.style.overflow="hidden"; if(document.body) document.body.style.overflow="hidden";
  }
  function logLogin(){
    try{
      fetch('/api/login-log', {
        method:'POST',
        headers:{'content-type':'application/json'},
        body: JSON.stringify({ k: SITE_PASSWORD }),
        keepalive: true
      }).catch(function(){});
    }catch(e){}
  }
  function tryUnlock(){
    var i=document.getElementById("gatePwd"); var v=i?i.value:"";
    if(v===SITE_PASSWORD){ try{sessionStorage.setItem(KEY, String(Date.now()));}catch(e){} logLogin(); reveal(); }
    else { showErr("密码错误，请重试"); if(i){ i.value=""; i.focus(); } }
  }
  function bind(){
    var i=document.getElementById("gatePwd"), b=document.getElementById("gateBtn");
    if(i) i.addEventListener("keydown",function(e){ if(e.key==="Enter") tryUnlock(); });
    if(b) b.addEventListener("click",tryUnlock); if(i) i.focus();
  }
  if(unlocked()){ reveal(); } else { lock(); }
  if(getGate()) bind();
  // 每小时强制重新登录：到期即重新弹出密码门
  setInterval(function(){ if(!unlocked()){ lock(); } }, 30 * 1000);
})();