/* === js-heart.js · 「给她的话」情感模块 ===
   1. 个性化问候：按时间叫她，挂在首页 appbar + 阅读页顶部
   2. 「给她的话」信笺：云端 KV 存储（/api/notes）+ 本机缓存兜底
   3. 夜间「想你」模式：暗色氛围 + 她的名字淡淡浮在背景上
   4. 纪念日：农历 11 月 29 日生日 —— 全站蛋糕 + 生日快乐歌（WebAudio 合成，无需音频文件）
   5. 小彩蛋（bindSmile）：切标签页标题说话 / 连点大标题飘爱心 +
      悄悄话 / 控制台留言 —— 全部零侵入、可失败（try/catch 包裹）
   测试钩子：window.__tbHeart（solarToLunar / isBday）
   全部 ES5，IIFE，不依赖任何库。改后升 index.html ?v= 令牌。 */
(function(){
  "use strict";
  var SITE_K = "1396788686";          // 与 js-gate.js 一致
  var NAME = "小猪猪你个胖崽";

  /* ---------- 1. 个性化问候 ---------- */
  function greetText(){
    var h = new Date().getHours(), t;
    if(h < 5)        t = "夜深了，梦里也早点见";
    else if(h < 9)   t = "早上好";
    else if(h < 12)  t = "上午好";
    else if(h < 14)  t = "中午好";
    else if(h < 18)  t = "下午好";
    else if(h < 23)  t = "晚上好";
    else             t = "夜深了，梦里也早点见";
    return NAME + "，" + t;
  }
  function paintGreet(){
    var s = greetText();
    ["greet-home", "greet-reader"].forEach(function(id){
      var el = document.getElementById(id);
      if(el) el.textContent = s;
    });
  }
  paintGreet();
  setInterval(paintGreet, 60000);

  /* ---------- 2. 「给她的话」信笺 ---------- */
  var LS_CACHE = "ting_notes_cache";
  var notes = [];
  function esc(s){ return String(s||"").replace(/[&<>"]/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
  function loadLocal(){
    try{ notes = JSON.parse(localStorage.getItem(LS_CACHE) || "[]") || []; }
    catch(e){ notes = []; }
  }
  function saveLocal(){
    try{ localStorage.setItem(LS_CACHE, JSON.stringify(notes.slice(0, 300))); }catch(e){}
  }
  function fmtT(ts){
    try{ var d = new Date(ts);
      return d.getFullYear() + "-" + ("0"+(d.getMonth()+1)).slice(-2) + "-" + ("0"+d.getDate()).slice(-2)
        + " " + ("0"+d.getHours()).slice(-2) + ":" + ("0"+d.getMinutes()).slice(-2);
    }catch(e){ return ""; }
  }
  function renderLetters(){
    var box = document.getElementById("letter-list");
    if(!box) return;
    if(!notes.length){ box.innerHTML = '<p class="muted">还没有写下第一句。想她的时候，就写一句吧。</p>'; return; }
    box.innerHTML = notes.map(function(n, i){
      var pre = n.text.length > 120 ? n.text.slice(0, 120) + "…" : n.text;
      return '<div class="letter-card">'
        + '<div class="letter-text">' + esc(pre).replace(/\n/g, "<br>") + '</div>'
        + '<div class="letter-meta"><span>' + fmtT(n.t) + '</span>'
        + '<button class="letter-del" data-i="' + i + '" title="删除">🗑</button></div>'
        + '</div>';
    }).join("");
  }
  function cloudGet(){
    fetch("/api/notes?k=" + encodeURIComponent(SITE_K))
      .then(function(r){ return r.json(); })
      .then(function(d){
        if(d && d.ok && d.records){ notes = d.records; saveLocal(); renderLetters(); }
      })
      .catch(function(){});   // 网络失败时静默保留本地缓存
  }
  function cloudAdd(text, done){
    fetch("/api/notes", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({ k: SITE_K, text: text })
    }).then(function(r){ return r.json(); }).then(function(d){ done(d && d.ok ? null : (d && d.error) || "云端写入失败", d); })
      .catch(function(){ done("网络错误，内容只存到了本机", null); });
  }
  function bindLetters(){
    var inp = document.getElementById("letter-input");
    var btn = document.getElementById("letter-save");
    var msg = document.getElementById("letter-msg");
    var list = document.getElementById("letter-list");
    if(!inp || !btn) return;
    btn.addEventListener("click", function(){
      var text = (inp.value || "").trim();
      if(!text){ msg.textContent = "写点什么再存吧"; return; }
      msg.textContent = "正在写进云端…";
      cloudAdd(text, function(err, d){
        if(err){ msg.textContent = err; return; }
        var rec = { id: (d && d.id) || "local:" + Date.now(), t: (d && d.t) || Date.now(), text: text };
        notes.unshift(rec); saveLocal(); renderLetters();
        inp.value = ""; msg.textContent = "已存好 ✔";
        setTimeout(function(){ msg.textContent = ""; }, 2500);
      });
    });
    list.addEventListener("click", function(ev){
      var b = ev.target.closest ? ev.target.closest(".letter-del") : null;
      if(!b) return;
      var i = parseInt(b.getAttribute("data-i"), 10);
      var n = notes[i];
      if(!n || !confirm("删除这条？删了就找不回来了。")) return;
      b.disabled = true;
      if(n.id && n.id.indexOf("note:") === 0){
        fetch("/api/notes", {
          method: "DELETE",
          headers: {"content-type": "application/json"},
          body: JSON.stringify({ k: SITE_K, id: n.id })
        }).then(function(r){ return r.json(); }).then(function(d){
          if(d && d.ok){ notes.splice(i, 1); saveLocal(); renderLetters(); }
          else { b.disabled = false; alert((d && d.error) || "删除失败"); }
        }).catch(function(){ b.disabled = false; alert("网络错误"); });
      } else {
        notes.splice(i, 1); saveLocal(); renderLetters();
      }
    });
    loadLocal(); renderLetters(); cloudGet();
  }

  /* ---------- 3. 夜间「想你」模式 ---------- */
  var MY_LS = "ting_missyou";
  function myLayer(){
    var el = document.getElementById("missyou-layer");
    if(el) return el;
    el = document.createElement("div");
    el.id = "missyou-layer";
    el.innerHTML = '<div class="my-name">漪默海</div><div class="my-sub">想你</div>';
    document.body.appendChild(el);
    return el;
  }
  function applyMy(on){
    try{ localStorage.setItem(MY_LS, on ? "1" : "0"); }catch(e){}
    document.body.classList.toggle("missyou", on);
    myLayer();
    var b = document.getElementById("missyou-toggle");
    if(b) b.textContent = on ? "🌙 夜间「想你」模式：开（点按关闭）" : "🌙 夜间「想你」模式：关";
  }
  function bindMy(){
    var b = document.getElementById("missyou-toggle");
    if(!b) return;
    b.addEventListener("click", function(){
      applyMy(!document.body.classList.contains("missyou"));
    });
    var on = false;
    try{ on = localStorage.getItem(MY_LS) === "1"; }catch(e){}
    if(on) applyMy(true);
  }

  /* ---------- 4. 纪念日：农历生日（11 月 29 日）---------- */
  // 经典农历算法（1900-2100），数据源为通行 lunarInfo 表
  var lunarInfo = [
    0x04bd8,0x04ae0,0x0a570,0x054d5,0x0d260,0x0d950,0x16554,0x056a0,0x09ad0,0x055d2,
    0x04ae0,0x0a5b6,0x0a4d0,0x0d250,0x1d255,0x0b540,0x0d6a0,0x0ada2,0x095b0,0x14977,
    0x04970,0x0a4b0,0x0b4b5,0x06a50,0x06d40,0x1ab54,0x02b60,0x09570,0x052f2,0x04970,
    0x06566,0x0d4a0,0x0ea50,0x06e95,0x05ad0,0x02b60,0x186e3,0x092e0,0x1c8d7,0x0c950,
    0x0d4a0,0x1d8a6,0x0b550,0x056a0,0x1a5b4,0x025d0,0x092d0,0x0d2b2,0x0a950,0x0b557,
    0x06ca0,0x0b550,0x15355,0x04da0,0x0a5b0,0x14573,0x052b0,0x0a9a8,0x0e950,0x06aa0,
    0x0aea6,0x0ab50,0x04b60,0x0aae4,0x0a570,0x05260,0x0f263,0x0d950,0x05b57,0x056a0,
    0x096d0,0x04dd5,0x04ad0,0x0a4d0,0x0d4d4,0x0d250,0x0d558,0x0b540,0x0b5a0,0x195a6,
    0x095b0,0x049b0,0x0a974,0x0a4b0,0x0b27a,0x06a50,0x06d40,0x0af46,0x0ab60,0x09570,
    0x04af5,0x04970,0x064b0,0x074a3,0x0ea50,0x06b58,0x05ac0,0x0ab60,0x096d5,0x092e0,
    0x0c960,0x0d954,0x0d4a0,0x0da50,0x07552,0x056a0,0x0abb7,0x025d0,0x092d0,0x0cab5,
    0x0a950,0x0b4a0,0x0baa4,0x0ad50,0x055d9,0x04ba0,0x0a5b0,0x15176,0x052b0,0x0a930,
    0x07954,0x06aa0,0x0ad50,0x05b52,0x04b60,0x0a6e6,0x0a4e0,0x0d260,0x0ea65,0x0d530,
    0x05aa0,0x076a3,0x096d0,0x04afb,0x04ad0,0x0a4d0,0x1d0b6,0x0d250,0x0d520,0x0dd45,
    0x0b5a0,0x056d0,0x055b2,0x049b0,0x0a577,0x0a4b0,0x0aa50,0x1b255,0x06d20,0x0ada0,
    0x14b63,0x09370,0x049f8,0x04970,0x064b0,0x168a6,0x0ea50,0x06b20,0x1a6c4,0x0aae0,
    0x0a2e0,0x0d2e3,0x0c960,0x0d557,0x0d4a0,0x0da50,0x05d55,0x056a0,0x0a6d0,0x055d4,
    0x052d0,0x0a9b8,0x0a950,0x0b4a0,0x0b6a6,0x0ad50,0x055a0,0x0aba4,0x0a5b0,0x052b0,
    0x0b273,0x06930,0x07337,0x06aa0,0x0ad50,0x14b55,0x04b60,0x0a570,0x054e4,0x0d160,
    0x0e968,0x0d520,0x0daa0,0x16aa6,0x056d0,0x04ae0,0x0a9d4,0x0a2d0,0x0d150,0x0f252,
    0x0d520
  ];
  function lYearDays(y){ var i, sum = 348;
    for(i = 0x8000; i > 0x8; i >>= 1) sum += (lunarInfo[y-1900] & i) ? 1 : 0;
    return sum + leapDays(y); }
  function leapMonth(y){ return lunarInfo[y-1900] & 0xf; }
  function leapDays(y){ return leapMonth(y) ? ((lunarInfo[y-1900] & 0x10000) ? 30 : 29) : 0; }
  function monthDays(y, m){ return (lunarInfo[y-1900] & (0x10000 >> m)) ? 30 : 29; }
  function solarToLunar(dt){
    var base = new Date(1900, 0, 31);
    var offset = Math.floor((Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()) - Date.UTC(1900, 0, 31)) / 86400000);
    var y = 1900, temp = 0, i;
    for(; y < 2101 && offset > 0; y++){ temp = lYearDays(y); offset -= temp; }
    if(offset < 0){ offset += temp; y--; }
    var leap = leapMonth(y), isLeap = false;
    for(i = 1; i < 13 && offset > 0; i++){
      if(leap > 0 && i === leap + 1 && !isLeap){ --i; isLeap = true; temp = leapDays(y); }
      else temp = monthDays(y, i);
      if(isLeap && i === leap + 1) isLeap = false;
      offset -= temp;
    }
    if(offset === 0 && leap > 0 && i === leap + 1){
      if(isLeap) isLeap = false; else { isLeap = true; --i; }
    }
    if(offset < 0){ offset += temp; --i; }
    return { y: y, m: i, d: offset + 1, leap: isLeap };
  }
  // 生日快乐歌（WebAudio 合成）—— midi 音高 + 节拍
  var MELODY = [
    [67,.75],[67,.25],[69,1],[67,1],[72,1],[71,2],
    [67,.75],[67,.25],[69,1],[67,1],[74,1],[72,2],
    [67,.75],[67,.25],[79,1],[76,1],[72,1],[71,1],[69,2],
    [77,.75],[77,.25],[76,1],[72,1],[74,1],[72,3]
  ];
  function playSong(){
    try{
      var AC = window.AudioContext || window.webkitAudioContext;
      if(!AC) return;
      var ac = window.__bdayAC || (window.__bdayAC = new AC());
      if(ac.state === "suspended") ac.resume();
      var t0 = ac.currentTime + 0.05, beat = 0.42;
      MELODY.forEach(function(n){
        var dur = n[1] * beat;
        var o = ac.createOscillator(), g = ac.createGain();
        o.type = "triangle";
        o.frequency.value = 440 * Math.pow(2, (n[0] - 69) / 12);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.92);
        o.connect(g); g.connect(ac.destination);
        o.start(t0); o.stop(t0 + dur + 0.05);
        t0 += dur;
      });
    }catch(e){}
  }
  function isBday(){
    var L = solarToLunar(new Date());
    return !L.leap && L.m === 11 && L.d === 29;
  }
  function showBday(){
    var ov = document.createElement("div");
    ov.id = "bday-overlay";
    ov.innerHTML =
      '<div class="bday-box">'
      + '<div class="bday-cake" title="点我放歌">🎂</div>'
      + '<div class="bday-title">生日快乐，' + NAME + '</div>'
      + '<div class="bday-sub">农历十一月廿九 · 这是为你亮着的一天</div>'
      + '<div class="bday-hint">点蛋糕，放一首生日快乐歌</div>'
      + '<button class="bday-close" type="button">先收下，继续逛</button>'
      + '</div>';
    document.body.appendChild(ov);
    ov.querySelector(".bday-cake").addEventListener("click", playSong);
    ov.querySelector(".bday-close").addEventListener("click", function(){
      try{ sessionStorage.setItem("ting_bday_dismissed", new Date().toDateString()); }catch(e){}
      var o = document.getElementById("bday-overlay");
      if(o) o.parentNode.removeChild(o);
    });
    // 触发一次淡入
    setTimeout(function(){ ov.classList.add("on"); }, 30);
  }
  function bindBday(){
    if(!isBday()) return;
    var off = "";
    try{ off = sessionStorage.getItem("ting_bday_dismissed") || ""; }catch(e){}
    if(off && off === new Date().toDateString()) return;
    showBday();
  }

  /* ---------- 5. 小彩蛋：如果有一天，她打开这个页面 ---------- */
  function bindSmile(){
    var baseTitle = document.title;
    // ① 切走/切回浏览器标签页时，标题轻轻说一句话
    try{
      document.addEventListener("visibilitychange", function(){
        if(document.hidden){
          document.title = "别走嘛…（小声）";
        } else {
          document.title = "欢迎回来 ♪ 诗都给你读好了";
          setTimeout(function(){ document.title = baseTitle; }, 2600);
        }
      });
    }catch(e){}
    // ② 连点首页大标题 5 次：飘一阵爱心 + 一句悄悄话
    var taps = 0, tapTimer = null;
    var WHISPERS = [
      "别戳啦，诗都排在下面等你翻牌呢～",
      "再戳一下，我就把整本书读给你听（认真的）",
      "诶，被你发现这里可以戳了？",
      "戳这么多下，是想我了吧。",
      "好啦好啦，全站都归你戳。"
    ];
    function heartRain(){
      try{
        for(var i = 0; i < 12; i++){
          var h = document.createElement("span");
          h.className = "smile-heart";
          h.textContent = ["💛","🧡","💗","💜"][i % 4];
          h.style.left = (15 + Math.random() * 70) + "vw";
          h.style.animationDelay = (Math.random() * 0.6) + "s";
          h.style.fontSize = (14 + Math.random() * 16) + "px";
          document.body.appendChild(h);
          (function(el){ setTimeout(function(){ if(el.parentNode) el.parentNode.removeChild(el); }, 3800); })(h);
        }
      }catch(e){}
    }
    var t = document.querySelector(".cover-head h1");
    if(t){
      t.addEventListener("click", function(){
        taps++;
        clearTimeout(tapTimer);
        tapTimer = setTimeout(function(){ taps = 0; }, 1600);
        if(taps >= 5){
          taps = 0;
          heartRain();
          var tip = document.createElement("div");
          tip.className = "smile-toast";
          tip.textContent = WHISPERS[Math.floor(Math.random() * WHISPERS.length)];
          document.body.appendChild(tip);
          setTimeout(function(){ if(tip.parentNode) tip.parentNode.removeChild(tip); }, 3200);
        }
      });
    }
    // ③ 控制台留言：留给那个好奇心重的人
    try{
      console.log("%c嘿 💛", "color:#b8902f;font-size:28px;font-weight:bold");
      console.log("%c你居然打开了控制台 —— 好奇心重的人，一般都很好看。", "color:#7a6a4a;font-size:13px");
      console.log("%c别研究代码啦。诗都读好了，信都写好了，背景图都挑好了，\n就等你回来。去「💌 给她的话」翻一翻吧。", "color:#9a8a6a;font-size:12px");
    }catch(e){}
  }

  /* ---------- 启动 ---------- */
  function boot(){
    bindLetters();
    bindMy();
    bindBday();
    bindSmile();
  }
  // 测试/调试钩子（农历换算与生日判定）
  window.__tbHeart = { solarToLunar: solarToLunar, isBday: isBday };
  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
