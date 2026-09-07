(function(){
"use strict";
var D = window.PHENOLOGY;
var NDAY = D.meta.nday, DOY0 = D.meta.doy0, YEARS = D.meta.years;

// A day's ratio is only meaningful if somebody was actually birding that day.
var MIN_EFF = 20;      // all-bird records required before a day enters the curve
var MIN_RECS = 25;     // species records required before a year is used at all
var SMOOTH = 7;        // centered moving average, in days

var state = {
  sid: (D.species.filter(function(x){return x.sci==="Icterus galbula";})[0]
        || D.species[0]).id,
  pid: D.places[0].id,
  pct: 15,
  sort: "cal"
};

/* ------------------------------------------------------------------ dates */
var MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul"];
var CUM = [0,31,59,90,120,151,181];               // cumulative days, common year
function doyLabel(doy){
  var d = Math.round(doy);
  for(var m=6;m>=0;m--){ if(d>CUM[m]) return MON[m]+" "+(d-CUM[m]); }
  return "Jan "+d;
}
function monthStarts(){
  var out=[];
  for(var m=1;m<=5;m++){ if(CUM[m]+1>=DOY0) out.push({doy:CUM[m]+1,name:MON[m]}); }
  return out;
}

/* ------------------------------------------------------- the computation */
function curve(sid,pid,year){
  var sp = D.counts[sid] && D.counts[sid][pid] && D.counts[sid][pid][year];
  var eff = D.effort[pid] && D.effort[pid][year];
  if(!sp||!eff) return null;
  var total=0,i,j;
  for(i=0;i<NDAY;i++) total+=sp[i];
  if(total<MIN_RECS) return {total:total, thin:true};
  var raw=new Array(NDAY), h=(SMOOTH-1)/2;
  for(i=0;i<NDAY;i++) raw[i] = eff[i]>=MIN_EFF ? sp[i]/eff[i] : null;
  var sm=new Array(NDAY), any=false;
  for(i=0;i<NDAY;i++){
    var s=0,n=0, lo=Math.max(0,i-h), hi=Math.min(NDAY-1,i+h);
    for(j=lo;j<=hi;j++) if(raw[j]!==null){ s+=raw[j]; n++; }
    sm[i] = n? s/n : 0;
    if(sm[i]>0) any=true;
  }
  return any ? {total:total, sm:sm, thin:false} : {total:total, thin:true};
}

function arrivalDoy(sm,pct){
  var tot=0,i;
  for(i=0;i<NDAY;i++) tot+=sm[i];
  if(tot<=0) return null;
  var target=tot*pct/100, acc=0;
  for(i=0;i<NDAY;i++){
    var prev=acc; acc+=sm[i];
    if(acc>=target){
      var f = sm[i]>0 ? (target-prev)/sm[i] : 0;
      return DOY0 + i + f;
    }
  }
  return null;
}

function seriesFor(sid,pid,pct){
  var w = D.weather[pid], out=[];
  for(var k=0;k<YEARS.length;k++){
    var y=YEARS[k], c=curve(sid,pid,String(y)), wx=w[y]||w[String(y)];
    if(!c||c.thin||!wx||wx.tMarApr===null){ out.push({year:y,ok:false,n:c?c.total:0}); continue; }
    var a=arrivalDoy(c.sm,pct);
    if(a===null){ out.push({year:y,ok:false,n:c.total}); continue; }
    out.push({year:y,ok:true,n:c.total,doy:a,sm:c.sm,
              temp:wx.tMarApr,gdd:wx.gdd,thermal:wx.thermalDoy});
  }
  return out;
}

function regress(rows){
  var pts=rows.filter(function(r){return r.ok;});
  var n=pts.length;
  if(n<5) return null;
  var sx=0,sy=0,i;
  for(i=0;i<n;i++){ sx+=pts[i].temp; sy+=pts[i].doy; }
  var mx=sx/n, my=sy/n, sxy=0,sxx=0,syy=0;
  for(i=0;i<n;i++){
    var dx=pts[i].temp-mx, dy=pts[i].doy-my;
    sxy+=dx*dy; sxx+=dx*dx; syy+=dy*dy;
  }
  if(sxx<=0||syy<=0) return null;
  var slope=sxy/sxx, r=sxy/Math.sqrt(sxx*syy);
  return {n:n, slope:slope, intercept:my-slope*mx, r2:r*r, r:r,
          meanDoy:my, tMin:Math.min.apply(null,pts.map(function(p){return p.temp;})),
          tMax:Math.max.apply(null,pts.map(function(p){return p.temp;}))};
}

/* --------------------------------------------------------- colour ramp */
function mix(a,b,t){
  function hx(c){return [parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16)];}
  var A=hx(a),B=hx(b);
  return "rgb("+A.map(function(v,i){return Math.round(v+(B[i]-v)*t);}).join(",")+")";
}
function css(v){ return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
function warmColor(t){                       // t in 0..1, cold -> warm
  var cold=css("--cold"), mid=css("--mid"), warm=css("--warm");
  return t<0.5 ? mix(cold,mid,t*2) : mix(mid,warm,(t-0.5)*2);
}

/* ------------------------------------------------------------- helpers */
function el(tag,attrs,kids){
  var e=document.createElementNS("http://www.w3.org/2000/svg",tag);
  for(var k in attrs) if(attrs[k]!==null&&attrs[k]!==undefined) e.setAttribute(k,attrs[k]);
  (kids||[]).forEach(function(c){e.appendChild(c);});
  return e;
}
function txt(s){ return document.createTextNode(s); }
function sp(){ return D.species.filter(function(s){return s.id===state.sid;})[0]; }
function pl(){ return D.places.filter(function(p){return p.id===state.pid;})[0]; }

function gbifSearchUrl(sid,place,year){
  return "https://www.gbif.org/occurrence/search?taxon_key="+sid+
    "&year="+year+"&basis_of_record=HUMAN_OBSERVATION"+
    "&decimal_latitude="+place.lat[0]+"%2C"+place.lat[1]+
    "&decimal_longitude="+place.lon[0]+"%2C"+place.lon[1];
}

/* ------------------------------------------------------------- ladder */
function drawLadder(rows,reg){
  var svg=document.getElementById("ladder");
  while(svg.firstChild) svg.removeChild(svg.firstChild);
  var TH=21, LEFT=46, RIGHT=58, TOP=34, BOT=24;
  var W=780, PW=W-LEFT-RIGHT, H=TOP+TH*rows.length+BOT;
  svg.setAttribute("viewBox","0 0 "+W+" "+H);
  svg.setAttribute("width",W); svg.setAttribute("height",H);
  var x=function(doy){ return LEFT+(doy-DOY0)/(NDAY-1)*PW; };

  var temps=rows.filter(function(r){return r.ok;}).map(function(r){return r.temp;});
  var tLo=Math.min.apply(null,temps), tHi=Math.max.apply(null,temps);
  var tScale=function(t){ return tHi>tLo ? (t-tLo)/(tHi-tLo) : 0.5; };

  var ink=css("--ink"), muted=css("--muted"), line=css("--line"), lineS=css("--line-strong");

  // month grid + labels
  monthStarts().forEach(function(m){
    svg.appendChild(el("line",{x1:x(m.doy),x2:x(m.doy),y1:TOP-8,y2:TOP+TH*rows.length,
      stroke:line,"stroke-width":1}));
    svg.appendChild(el("text",{x:x(m.doy)+4,y:TOP-13,"font-size":10.5,fill:muted,
      "letter-spacing":".08em"},[txt(m.name.toUpperCase())]));
  });

  var order=rows.slice();
  if(state.sort==="warm"){
    order.sort(function(a,b){
      if(!a.ok&&!b.ok) return a.year-b.year;
      if(!a.ok) return 1; if(!b.ok) return -1;
      return a.temp-b.temp;
    });
  }
  var pos={}; order.forEach(function(r,i){ pos[r.year]=i; });

  rows.forEach(function(r){
    var g=el("g",{class:"track",transform:"translate(0,"+(TOP+pos[r.year]*TH)+")",
      style:"cursor:"+(r.ok?"pointer":"default")});
    g.appendChild(el("rect",{class:"track-hit",x:0,y:0,width:W,height:TH,fill:"transparent"}));
    g.appendChild(el("text",{x:LEFT-9,y:TH/2+3.5,"text-anchor":"end","font-size":10.5,
      fill:r.ok?ink:muted,"fill-opacity":r.ok?1:0.45},[txt(String(r.year))]));

    if(!r.ok){
      g.appendChild(el("text",{x:LEFT+4,y:TH/2+3.5,"font-size":9.5,fill:muted,"fill-opacity":.6},
        [txt("too few records ("+r.n+")")]));
      svg.appendChild(g); return;
    }

    var col=warmColor(tScale(r.temp));
    var mx=0,i;
    for(i=0;i<NDAY;i++) if(r.sm[i]>mx) mx=r.sm[i];
    var base=TH-4, amp=TH-8;
    var d="M "+LEFT+" "+base;
    for(i=0;i<NDAY;i++){
      d+=" L "+(LEFT+i/(NDAY-1)*PW).toFixed(2)+" "+(base-(mx>0?r.sm[i]/mx:0)*amp).toFixed(2);
    }
    d+=" L "+(LEFT+PW)+" "+base+" Z";
    g.appendChild(el("path",{d:d,fill:col,"fill-opacity":.5,stroke:col,"stroke-width":.9,
      "stroke-opacity":.95}));
    g.appendChild(el("line",{x1:x(r.doy),x2:x(r.doy),y1:1.5,y2:TH-2,
      stroke:ink,"stroke-width":1.6}));
    g.appendChild(el("text",{x:LEFT+PW+7,y:TH/2+3.5,"font-size":10,fill:muted},
      [txt(doyLabel(r.doy))]));

    var t=el("title",{},[]); t.appendChild(txt(
      r.year+" — arrived "+doyLabel(r.doy)+" (day "+Math.round(r.doy)+")"+
      "\nSpring mean "+r.temp.toFixed(1)+" °C · "+Math.round(r.gdd)+" growing degree days"+
      "\n"+r.n.toLocaleString()+" records · click to open in GBIF"));
    g.appendChild(t);
    g.addEventListener("click",function(){
      window.open(gbifSearchUrl(state.sid,pl(),r.year),"_blank","noopener");
    });
    svg.appendChild(g);
  });

  // baseline
  svg.appendChild(el("line",{x1:LEFT,x2:LEFT+PW,y1:TOP+TH*rows.length+1,y2:TOP+TH*rows.length+1,
    stroke:lineS,"stroke-width":1}));
  svg.appendChild(el("text",{x:LEFT,y:H-8,"font-size":10,fill:muted},
    [txt("1 Feb")]));
  svg.appendChild(el("text",{x:LEFT+PW,y:H-8,"font-size":10,fill:muted,"text-anchor":"end"},
    [txt("30 Jun")]));
}

function niceStep(range,target){
  var raw=range/Math.max(1,target);
  var mag=Math.pow(10,Math.floor(Math.log10(Math.max(raw,1e-6))));
  var n=raw/mag;
  var step=(n<1.5?1:n<3?2:n<7?5:10)*mag;
  return Math.max(1,Math.round(step));
}

/* ------------------------------------------------------------ scatter */
function drawScatter(rows,reg){
  var svg=document.getElementById("scatter");
  while(svg.firstChild) svg.removeChild(svg.firstChild);
  var W=420,H=300,L=46,R=14,T=16,B=40, PW=W-L-R, PH=H-T-B;
  svg.setAttribute("viewBox","0 0 "+W+" "+H);
  svg.setAttribute("width",W); svg.setAttribute("height",H);
  var ink=css("--ink"), muted=css("--muted"), line=css("--line"), accent=css("--accent");
  var pts=rows.filter(function(r){return r.ok;});
  if(pts.length<3){
    svg.appendChild(el("text",{x:W/2,y:H/2,"text-anchor":"middle","font-size":12,fill:muted},
      [txt("Not enough complete years")]));
    return;
  }
  var ts=pts.map(function(p){return p.temp;}), ds=pts.map(function(p){return p.doy;});
  var t0=Math.min.apply(null,ts), t1=Math.max.apply(null,ts);
  var d0=Math.min.apply(null,ds), d1=Math.max.apply(null,ds);
  var tPad=(t1-t0)*0.10||1, dPad=(d1-d0)*0.12||2;
  t0-=tPad; t1+=tPad; d0-=dPad; d1+=dPad;
  var X=function(t){return L+(t-t0)/(t1-t0)*PW;};
  var Y=function(d){return T+PH-(d-d0)/(d1-d0)*PH;};   // later = higher up

  // y gridlines on real dates. Pick a step that actually lands ~5 labels inside
  // the range -- a fixed step draws one lonely tick whenever a species' arrival
  // dates cluster into a week, which is most of them.
  var step=niceStep(d1-d0,5);
  var start=Math.ceil(d0/step)*step;
  for(var v=start;v<=d1;v+=step){
    svg.appendChild(el("line",{x1:L,x2:L+PW,y1:Y(v),y2:Y(v),stroke:line,"stroke-width":1}));
    svg.appendChild(el("text",{x:L-7,y:Y(v)+3.5,"text-anchor":"end","font-size":9.5,fill:muted},
      [txt(doyLabel(v))]));
  }
  // x ticks
  var xs=4;
  for(var i=0;i<=xs;i++){
    var tv=t0+(t1-t0)*i/xs;
    svg.appendChild(el("text",{x:X(tv),y:H-22,"text-anchor":"middle","font-size":9.5,fill:muted},
      [txt(tv.toFixed(1))]));
  }
  svg.appendChild(el("text",{x:L+PW/2,y:H-6,"text-anchor":"middle","font-size":10,fill:muted,
    "letter-spacing":".06em"},[txt("MEAN MARCH–APRIL TEMPERATURE (°C)")]));

  if(reg){
    var ya=reg.intercept+reg.slope*t0, yb=reg.intercept+reg.slope*t1;
    var cy0=Math.max(d0,Math.min(d1,ya)), cy1=Math.max(d0,Math.min(d1,yb));
    var cx0=reg.slope!==0?(cy0-reg.intercept)/reg.slope:t0;
    var cx1=reg.slope!==0?(cy1-reg.intercept)/reg.slope:t1;
    svg.appendChild(el("line",{x1:X(cx0),y1:Y(cy0),x2:X(cx1),y2:Y(cy1),
      stroke:accent,"stroke-width":2,"stroke-dasharray":"5 3"}));
  }
  var tLo=Math.min.apply(null,ts), tHi=Math.max.apply(null,ts);
  pts.forEach(function(p){
    var c=warmColor(tHi>tLo?(p.temp-tLo)/(tHi-tLo):0.5);
    var g=el("g",{});
    g.appendChild(el("circle",{cx:X(p.temp),cy:Y(p.doy),r:5,fill:c,stroke:ink,
      "stroke-width":.8,"fill-opacity":.85}));
    var t=el("title",{},[]); t.appendChild(txt(
      p.year+" — "+doyLabel(p.doy)+", spring mean "+p.temp.toFixed(1)+" °C"));
    g.appendChild(t);
    svg.appendChild(g);
  });
}

/* ------------------------------------------------------ control table */
function drawControls(){
  var tbl=document.getElementById("controlTable");
  tbl.innerHTML="";
  var rows=D.species.map(function(s){
    var r=regress(seriesFor(s.id,state.pid,state.pct));
    return {s:s, reg:r};
  });
  var mag=0;
  rows.forEach(function(r){ if(r.reg) mag=Math.max(mag,Math.abs(r.reg.slope)); });
  rows.sort(function(a,b){
    if(!a.reg&&!b.reg) return 0; if(!a.reg) return 1; if(!b.reg) return -1;
    return a.reg.slope-b.reg.slope;
  });
  var thead=document.createElement("thead");
  thead.innerHTML="<tr><th>Species</th><th>Migration</th>"+
    "<th style='text-align:right'>Days per °C</th><th style='width:78px'></th></tr>";
  tbl.appendChild(thead);
  var tb=document.createElement("tbody");
  rows.forEach(function(r){
    var tr=document.createElement("tr");
    var isCtl=r.s.group.indexOf("resident")===0;
    tr.className=(r.s.id===state.sid?"self ":"")+(isCtl?"is-control":"");
    var slope=r.reg?r.reg.slope:null;
    var w=(slope!==null&&mag>0)?Math.abs(slope)/mag*100:0;
    var col=isCtl?css("--ctrl"):(slope!==null&&slope<0?css("--warm"):css("--cold"));
    tr.innerHTML =
      "<td>"+(isCtl?"<span class='dot'></span>":"")+r.s.name+"</td>"+
      "<td style='color:var(--muted);font-size:12px'>"+r.s.group.replace(" (control)","")+"</td>"+
      "<td class='num'>"+(slope!==null?(slope>0?"+":"")+slope.toFixed(1):"—")+"</td>"+
      "<td><span class='bar' style='width:"+w.toFixed(0)+"%;background:"+col+"'></span></td>";
    tr.style.cursor="pointer";
    tr.addEventListener("click",function(){ state.sid=r.s.id; render(); });
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);
}

/* ------------------------------------------------- the lie detector */
// Residents are here all winter, so their "arrival" slope should be ~0. Whatever
// they do report is the method's own drift in that place -- effort, weather-driven
// birding habits, anything but migration. Subtract it before believing a migrant.
function controlBaseline(pid,pct){
  var vals=[];
  D.species.forEach(function(s){
    if(s.group.indexOf("resident")!==0) return;
    var r=regress(seriesFor(s.id,pid,pct));
    if(r) vals.push(r.slope);
  });
  if(!vals.length) return null;
  var m=0; vals.forEach(function(v){m+=v;});
  return m/vals.length;
}

/* --------------------------------------------------------------- stats */
function drawStats(rows,reg){
  var box=document.getElementById("stats"), v=document.getElementById("verdict");
  var pts=rows.filter(function(r){return r.ok;});
  var recs=pts.reduce(function(a,r){return a+r.n;},0);
  var base=controlBaseline(state.pid,state.pct);
  var s=sp(), isCtl=s.group.indexOf("resident")===0;
  function stat(val,key,cls){
    return "<div class='stat'><span class='v'"+(cls?" style='color:"+cls+"'":"")+">"+val+
      "</span><span class='k'>"+key+"</span></div>";
  }
  var slope=reg?reg.slope:null;
  var drifty = base!==null && Math.abs(base)>0.4;
  box.innerHTML =
    stat(slope!==null?(slope>0?"+":"")+slope.toFixed(2):"—","days per °C")+
    stat(reg?reg.r2.toFixed(2):"—","r²")+
    stat(base!==null?(base>0?"+":"")+base.toFixed(2):"—","control drift",
         drifty?css("--warm"):css("--ctrl"))+
    stat(pts.length+"/"+YEARS.length,"springs used")+
    stat(recs.toLocaleString(),"records");

  if(!reg){ v.className="verdict flat";
    v.textContent="Not enough complete springs to fit a line here."; return; }

  var spread=reg.tMax-reg.tMin;
  var adj = base!==null ? reg.slope-base : reg.slope;
  var shift=Math.abs(adj*spread);
  var strong=Math.abs(adj)>=0.5 && reg.r2>=0.15 && !drifty;

  if(isCtl){
    v.className="verdict flat";
    v.innerHTML="<b>"+s.name+" is a control, not a result.</b> It is here all winter, so it has "+
      "no arrival to shift. The method reports <b>"+(reg.slope>0?"+":"")+reg.slope.toFixed(2)+
      " days/°C</b> for it — and that number is the error bar for every migrant in this place. "+
      (drifty
        ? "It is <b>not</b> close to zero here, which is a warning, not a finding."
        : "It is close to zero, which is the method passing its own test.");
  } else if(drifty){
    v.className="verdict flat";
    v.innerHTML="<b>Read this place with suspicion.</b> The resident controls here drift "+
      (base>0?"+":"")+base.toFixed(2)+" days/°C, and residents cannot arrive at all. Something "+
      "other than migration — most likely how warm springs change when people go birding — is "+
      "moving these curves. "+s.name+"'s raw "+reg.slope.toFixed(2)+" is only <b>"+
      (adj>0?"+":"")+adj.toFixed(2)+" days/°C</b> once that drift is removed.";
  } else if(strong){
    v.className="verdict";
    v.innerHTML="Across springs from <b>"+reg.tMin.toFixed(1)+"&nbsp;°C to "+reg.tMax.toFixed(1)+
      "&nbsp;°C</b>, the warmest runs about <b>"+shift.toFixed(1)+" days "+
      (adj<0?"earlier":"later")+"</b> than the coldest — "+Math.abs(adj).toFixed(2)+
      " days per degree, after the resident drift of "+(base!==null?base.toFixed(2):"0")+
      " is subtracted. Warmth accounts for "+Math.round(reg.r2*100)+"% of the year-to-year spread.";
  } else {
    v.className="verdict flat";
    v.innerHTML="<b>No clear response.</b> The fit gives "+(adj>0?"+":"")+adj.toFixed(2)+
      " days/°C with an r² of "+reg.r2.toFixed(2)+" — the years scatter about as much as they "+
      "would with no relationship at all. For a long-distance migrant that is the expected "+
      "answer, not a failure: see the note on daylength below.";
  }
}

/* -------------------------------------------------------------- render */
function render(){
  var s=sp(), p=pl();
  var rows=seriesFor(state.sid,state.pid,state.pct);
  var reg=regress(rows);

  document.querySelectorAll("#speciesChips .chip").forEach(function(b){
    b.setAttribute("aria-pressed",String(b.dataset.id===state.sid));
  });
  document.querySelectorAll("#placeChips .chip").forEach(function(b){
    b.setAttribute("aria-pressed",String(b.dataset.id===state.pid));
  });
  document.getElementById("sortCal").setAttribute("aria-pressed",String(state.sort==="cal"));
  document.getElementById("sortWarm").setAttribute("aria-pressed",String(state.sort==="warm"));
  document.getElementById("pctOut").textContent=state.pct+"%";
  document.getElementById("gbifLink").href=s.gbif;
  document.getElementById("gbifLink").textContent=s.sci+" ↗";
  document.getElementById("placeBox").textContent=
    p.lat[0]+"–"+p.lat[1]+"°N, "+Math.abs(p.lon[1])+"–"+Math.abs(p.lon[0])+"°W";
  document.getElementById("ladderTitle").textContent=s.name+" in "+p.name;
  document.getElementById("ladderSub").textContent=
    state.sort==="warm"?"coldest spring at top → warmest at bottom":"2000 at top → 2024 at bottom";
  document.getElementById("sortHint").textContent = state.sort==="warm"
    ? "Years now run coldest to warmest. A real effect makes the ticks lean."
    : "Switch to warmth and watch the ticks.";

  drawLadder(rows,reg);
  drawScatter(rows,reg);
  drawStats(rows,reg);
  drawControls();
}

/* ---------------------------------------------------------------- init */
function init(){
  var sc=document.getElementById("speciesChips");
  D.species.forEach(function(s){
    var b=document.createElement("button");
    b.className="chip"+(s.group.indexOf("resident")===0?" is-control":"");
    b.dataset.id=s.id; b.type="button";
    b.innerHTML=(s.group.indexOf("resident")===0?"<span class='dot'></span>":"")+s.name;
    b.title=s.sci+" — "+s.group;
    b.addEventListener("click",function(){ state.sid=s.id; render(); });
    sc.appendChild(b);
  });
  var pc=document.getElementById("placeChips");
  D.places.forEach(function(p){
    var b=document.createElement("button");
    b.className="chip"; b.dataset.id=p.id; b.type="button";
    b.textContent=p.name.replace(" metro",""); b.title=p.note;
    b.addEventListener("click",function(){ state.pid=p.id; render(); });
    pc.appendChild(b);
  });
  document.getElementById("pct").addEventListener("input",function(e){
    state.pct=+e.target.value; render();
  });
  document.getElementById("sortCal").addEventListener("click",function(){state.sort="cal";render();});
  document.getElementById("sortWarm").addEventListener("click",function(){state.sort="warm";render();});
  document.getElementById("plainBtn").addEventListener("click",function(){
    var on=document.body.classList.toggle("plain-on");
    this.setAttribute("aria-pressed",String(on));
  });
  document.querySelectorAll("[data-theme-set]").forEach(function(b){
    b.addEventListener("click",function(){
      var m=b.dataset.themeSet;
      try{ localStorage.setItem("aos-theme",m); }catch(e){}
      applyTheme(m); render();               // re-read the CSS colour tokens
    });
  });
  document.getElementById("builtOn").textContent="Built "+D.meta.built;
  render();
}
function applyTheme(m){
  var r=document.documentElement;
  if(m==="auto") r.removeAttribute("data-theme"); else r.setAttribute("data-theme",m);
  document.querySelectorAll("[data-theme-set]").forEach(function(b){
    b.setAttribute("aria-pressed",String(b.dataset.themeSet===m));
  });
}
var saved="auto";
try{ saved=localStorage.getItem("aos-theme")||"auto"; }catch(e){}
applyTheme(saved);
if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",init);
else init();
})();
