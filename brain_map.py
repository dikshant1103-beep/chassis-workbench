"""
Generate a brain-styled, fully animated, interactive neural mind map.
Canvas-based rendering (60fps), D3 force layout, neural signal particles.
"""
import json
from pathlib import Path
from collections import defaultdict

raw   = json.loads(Path("graphify-out/graph.json").read_text(encoding="utf-8"))
NODES = raw["nodes"]
LINKS = raw["links"]

# ── Brain region colours (vivid neon, per community) ─────────────────────────
PALETTE = [
    "#00f5ff","#bf00ff","#ff0090","#00ff88","#ff6600",
    "#0088ff","#ffdd00","#ff3366","#00ffcc","#aa00ff",
    "#ff8800","#00ccff","#ff0055","#44ff00","#ff00ff",
    "#00aaff","#ffaa00","#00ff66","#cc00ff","#ff5500",
]

degree: dict[str, int] = defaultdict(int)
for lnk in LINKS:
    degree[lnk["source"]] += 1
    degree[lnk["target"]] += 1
max_deg = max(degree.values(), default=1) or 1

comm_sizes: dict[int, int] = defaultdict(int)
for n in NODES:
    cid = n.get("community", 0)
    if isinstance(cid, int):
        comm_sizes[cid] += 1

def short_label(s: str) -> str:
    s = s.strip().replace("\n", " ")
    return s[:36] + "…" if len(s) > 36 else s

d3_nodes = []
for n in NODES:
    nid = n["id"]
    cid = n.get("community", 0) if isinstance(n.get("community"), int) else 0
    deg = degree.get(nid, 1)
    size = max(3, min(22, 3 + 19 * (deg / max_deg)))
    sf = n.get("source_file","").replace("/home/dikshant/Desktop/Moter_bike/","")
    d3_nodes.append({
        "id":        nid,
        "label":     short_label(n.get("label", nid)),
        "full":      n.get("label", nid),
        "sf":        sf,
        "loc":       n.get("source_location",""),
        "ftype":     n.get("file_type","code"),
        "community": cid,
        "color":     PALETTE[cid % len(PALETTE)],
        "degree":    deg,
        "r":         round(size, 1),
    })

d3_links = []
for lnk in LINKS:
    d3_links.append({
        "source":     lnk["source"],
        "target":     lnk["target"],
        "relation":   lnk.get("relation",""),
        "confidence": lnk.get("confidence","EXTRACTED"),
    })

top_comms = sorted(comm_sizes.items(), key=lambda x: -x[1])[:25]
legend = [{"cid": c, "color": PALETTE[c % len(PALETTE)], "count": cnt}
          for c, cnt in top_comms]

nodes_js  = json.dumps(d3_nodes).replace("</","<\\/")
links_js  = json.dumps(d3_links).replace("</","<\\/")
legend_js = json.dumps(legend).replace("</","<\\/")
stats_txt = f"{len(NODES)} nodes · {len(LINKS)} edges · {len(comm_sizes)} communities"

HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>🧠 Moter_bike — Neural Mind Map</title>
<script src="https://d3js.org/d3.v7.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#030309;overflow:hidden;display:flex;height:100vh;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
#wrap{position:relative;flex:1;overflow:hidden}
canvas{position:absolute;top:0;left:0;display:block}

/* ── sidebar ── */
#sidebar{width:290px;background:#08081a;border-left:1px solid #1a1a3a;display:flex;flex-direction:column;overflow:hidden;z-index:20}
#search-wrap{padding:12px;border-bottom:1px solid #1a1a3a}
#search{width:100%;background:#030309;border:1px solid #2a2a5a;color:#e0e0ff;padding:8px 12px;border-radius:20px;font-size:13px;outline:none;transition:border-color .2s}
#search:focus{border-color:#00f5ff;box-shadow:0 0 8px #00f5ff44}
#results-list{max-height:150px;overflow-y:auto;padding:4px 10px;border-bottom:1px solid #1a1a3a;display:none}
.result-item{padding:5px 8px;cursor:pointer;border-radius:4px;font-size:12px;color:#ccc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.result-item:hover{background:#12123a;color:#00f5ff}

#info-panel{padding:14px;border-bottom:1px solid #1a1a3a}
#info-panel h3{font-size:10px;color:#555;text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px}
.field{margin-bottom:8px;font-size:12px;line-height:1.5}
.field b{color:#7799cc;font-size:10px;text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:2px}
.field .val{color:#dde;word-break:break-word}
.badge{display:inline-block;padding:3px 10px;border-radius:12px;font-size:10px;font-weight:700;margin-top:4px;letter-spacing:.05em}
.empty{color:#333;font-style:italic;font-size:12px}

#nb-section{padding:10px 14px;border-bottom:1px solid #1a1a3a;max-height:220px;overflow-y:auto;display:none}
#nb-section h3{font-size:10px;color:#555;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px}
.nb-item{padding:5px 8px;margin:2px 0;border-radius:5px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:8px;border-left:3px solid transparent;transition:background .15s}
.nb-item:hover{background:#10102a}
.nb-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.nb-lbl{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#bbc}
.nb-rel{color:#445;font-size:10px;flex-shrink:0}

#legend-section{flex:1;overflow-y:auto;padding:12px}
#legend-section h3{font-size:10px;color:#555;text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px}
.lg-item{display:flex;align-items:center;gap:8px;padding:4px 4px;cursor:pointer;border-radius:4px;font-size:12px;transition:background .15s}
.lg-item:hover{background:#12123a}
.lg-item.off{opacity:.25}
.lg-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.lg-lbl{flex:1;color:#99a;font-size:11px}
.lg-cnt{color:#444;font-size:10px}

#stats-bar{padding:8px 14px;border-top:1px solid #1a1a3a;font-size:10px;color:#333;letter-spacing:.04em}

/* ── hud controls ── */
#hud{position:absolute;bottom:18px;left:18px;display:flex;gap:8px;z-index:30}
.hud-btn{background:#08081acc;border:1px solid #2a2a5a;color:#99aacc;padding:7px 16px;border-radius:20px;cursor:pointer;font-size:12px;backdrop-filter:blur(4px);transition:all .2s}
.hud-btn:hover{background:#12123a;color:#00f5ff;border-color:#00f5ff55;box-shadow:0 0 12px #00f5ff33}

/* ── tooltip ── */
#tip{position:absolute;background:#08081aee;border:1px solid #2a2a5a;padding:8px 12px;border-radius:8px;font-size:12px;pointer-events:none;opacity:0;transition:opacity .15s;max-width:260px;z-index:40;color:#cce;line-height:1.5}
</style>
</head>
<body>

<div id="wrap">
  <canvas id="bg"></canvas>
  <canvas id="main"></canvas>
  <div id="tip"></div>
  <div id="hud">
    <button class="hud-btn" onclick="resetView()">⌂ Reset</button>
    <button class="hud-btn" id="pause-btn" onclick="toggleSim()">⏸ Pause</button>
    <button class="hud-btn" onclick="burstFire()">⚡ Burst</button>
    <button class="hud-btn" onclick="showAll()">☀ All</button>
  </div>
</div>

<div id="sidebar">
  <div id="search-wrap">
    <input id="search" placeholder="🔍  Search nodes…" autocomplete="off">
    <div id="results-list"></div>
  </div>
  <div id="info-panel">
    <h3>Node Inspector</h3>
    <div id="info-content"><span class="empty">Click any node to inspect</span></div>
  </div>
  <div id="nb-section">
    <h3>Connections &mdash; <span id="nb-cnt">0</span></h3>
    <div id="nb-list"></div>
  </div>
  <div id="legend-section">
    <h3>Communities</h3>
    <div id="legend"></div>
  </div>
  <div id="stats-bar">""" + stats_txt + r"""</div>
</div>

<script>
const RAW_NODES = """ + nodes_js + r""";
const RAW_LINKS = """ + links_js + r""";
const LEGEND    = """ + legend_js + r""";

// ── Canvas setup ──────────────────────────────────────────────────────────────
const wrap  = document.getElementById("wrap");
const bgCvs = document.getElementById("bg");
const cvs   = document.getElementById("main");
const bgCtx = bgCvs.getContext("2d");
const ctx   = cvs.getContext("2d");

function resize() {
  const W = wrap.clientWidth, H = wrap.clientHeight;
  bgCvs.width = cvs.width = W;
  bgCvs.height = cvs.height = H;
  drawBG();
}
window.addEventListener("resize", resize);

function drawBG() {
  const W = bgCvs.width, H = bgCvs.height;
  bgCtx.clearRect(0,0,W,H);
  // deep space gradient
  const g = bgCtx.createRadialGradient(W*.5,H*.5,0, W*.5,H*.5,Math.max(W,H)*.7);
  g.addColorStop(0,   "#0d0d28");
  g.addColorStop(0.5, "#06061a");
  g.addColorStop(1,   "#030309");
  bgCtx.fillStyle = g;
  bgCtx.fillRect(0,0,W,H);
  // subtle brain lobes
  for (let i=0;i<6;i++) {
    const bx = W*.2 + i*W*.13, by = H*.3 + Math.sin(i)*H*.2;
    const bg2 = bgCtx.createRadialGradient(bx,by,0,bx,by,W*.22);
    bg2.addColorStop(0, "rgba(80,0,180,0.04)");
    bg2.addColorStop(1, "rgba(0,0,0,0)");
    bgCtx.fillStyle = bg2;
    bgCtx.fillRect(0,0,W,H);
  }
}

// ── State ─────────────────────────────────────────────────────────────────────
let transform  = {x: 0, y: 0, k: 1};
let selectedId = null;
let hoveredId  = null;
let simPaused  = false;
let hiddenComm = new Set();
let mouse      = {x: 0, y: 0};

// ── D3 force simulation ───────────────────────────────────────────────────────
const sim = d3.forceSimulation(RAW_NODES)
  .force("link",    d3.forceLink(RAW_LINKS).id(d=>d.id).distance(70).strength(0.35))
  .force("charge",  d3.forceManyBody().strength(-200).distanceMax(350))
  .force("center",  d3.forceCenter(0, 0))
  .force("collide", d3.forceCollide(d => d.r + 3).strength(0.7))
  .alphaDecay(0.012)
  .on("tick", () => {});   // rendering is in rAF loop

// keep simulation gently alive forever
function gentleBreath() {
  if (!simPaused) {
    RAW_NODES.forEach(n => {
      n.vx = (n.vx||0) + (Math.random()-.5)*0.4;
      n.vy = (n.vy||0) + (Math.random()-.5)*0.4;
    });
    sim.alpha(Math.max(sim.alpha(), 0.03)).restart();
  }
  setTimeout(gentleBreath, 3500 + Math.random()*2000);
}
gentleBreath();

// ── Lookup maps ───────────────────────────────────────────────────────────────
const nodeById = new Map(RAW_NODES.map(n=>[n.id, n]));
const adjMap   = new Map(RAW_NODES.map(n=>[n.id, []]));
RAW_LINKS.forEach((l,i) => {
  const s = typeof l.source==="object" ? l.source.id : l.source;
  const t = typeof l.target==="object" ? l.target.id : l.target;
  adjMap.get(s)?.push({nb:t, rel:l.relation, conf:l.confidence, dir:"out", li:i});
  adjMap.get(t)?.push({nb:s, rel:l.relation, conf:l.confidence, dir:"in",  li:i});
});

// ── Quadtree for hit detection ────────────────────────────────────────────────
function findNode(wx, wy) {
  let best=null, bestD=Infinity;
  for (const n of RAW_NODES) {
    if (hiddenComm.has(n.community)) continue;
    const dx=n.x-wx, dy=n.y-wy, d=Math.sqrt(dx*dx+dy*dy);
    const hit = n.r + 4;
    if (d < hit && d < bestD) { best=n; bestD=d; }
  }
  return best;
}

// world ↔ screen
function toScreen(wx,wy) {
  const W=cvs.width, H=cvs.height;
  return { x: wx*transform.k + transform.x + W/2,
           y: wy*transform.k + transform.y + H/2 };
}
function toWorld(sx,sy) {
  const W=cvs.width, H=cvs.height;
  return { x: (sx - W/2 - transform.x)/transform.k,
           y: (sy - H/2 - transform.y)/transform.k };
}

// ── Zoom / pan ────────────────────────────────────────────────────────────────
let panning=false, panStart={x:0,y:0};
cvs.addEventListener("mousedown", e => {
  if (e.button!==0) return;
  panning=true; panStart={x:e.clientX-transform.x, y:e.clientY-transform.y};
});
window.addEventListener("mouseup", e => {
  if (e.button!==0) return;
  panning=false;
});
cvs.addEventListener("mousemove", e => {
  mouse.x=e.clientX; mouse.y=e.clientY;
  if (panning) {
    transform.x = e.clientX - panStart.x;
    transform.y = e.clientY - panStart.y;
  }
  const w = toWorld(e.clientX, e.clientY);
  const n = findNode(w.x, w.y);
  hoveredId = n ? n.id : null;
  cvs.style.cursor = n ? "pointer" : (panning ? "grabbing" : "grab");
  updateTooltip(n, e);
});
cvs.addEventListener("wheel", e => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.12 : 0.89;
  const W=cvs.width, H=cvs.height;
  const mx=e.clientX-W/2, my=e.clientY-H/2;
  transform.x = mx + (transform.x-mx)*factor;
  transform.y = my + (transform.y-my)*factor;
  transform.k = Math.max(0.05, Math.min(4, transform.k*factor));
}, {passive:false});
cvs.addEventListener("click", e => {
  if (Math.abs(e.clientX-panStart.x-transform.x)>4) return;
  const w = toWorld(e.clientX, e.clientY);
  const n = findNode(w.x, w.y);
  if (n) selectNode(n); else deselect();
});

// ── Neural signals (particles) ────────────────────────────────────────────────
const particles = [];
const MAX_PARTICLES = 120;

function spawnParticle(link) {
  const s = typeof link.source==="object" ? link.source : nodeById.get(link.source);
  const t = typeof link.target==="object" ? link.target : nodeById.get(link.target);
  if (!s||!t) return;
  if (hiddenComm.has(s.community)||hiddenComm.has(t.community)) return;
  particles.push({
    s, t,
    p: 0,
    speed: 0.006 + Math.random()*0.012,
    color: s.color,
    size:  1.5 + Math.random()*2,
    trail: [],
  });
}

// auto-fire neural signals
function autoFire() {
  if (!simPaused && particles.length < MAX_PARTICLES) {
    const count = 2 + Math.floor(Math.random()*5);
    for (let i=0;i<count;i++) {
      const lnk = RAW_LINKS[Math.floor(Math.random()*RAW_LINKS.length)];
      spawnParticle(lnk);
    }
  }
  setTimeout(autoFire, 120 + Math.random()*180);
}
autoFire();

// fire along selected node's edges
function burstFire() {
  const links = selectedId
    ? RAW_LINKS.filter(l => {
        const s = typeof l.source==="object" ? l.source.id : l.source;
        const t = typeof l.target==="object" ? l.target.id : l.target;
        return s===selectedId||t===selectedId;
      })
    : RAW_LINKS;
  const pick = links.sort(()=>Math.random()-.5).slice(0,40);
  pick.forEach(l => spawnParticle(l));
  // brief alpha boost
  if (!simPaused) sim.alpha(0.3).restart();
}

// ── Node pulse state ──────────────────────────────────────────────────────────
const pulseMap = new Map(); // nodeId → {t, maxT}
function pulseNode(id, dur=600) {
  pulseMap.set(id, {t:0, maxT:dur});
}

// ── Rendering ─────────────────────────────────────────────────────────────────
let lastTs = 0;
const neighborSet = new Set();
const neighborLinks = new Set();

function frame(ts) {
  requestAnimationFrame(frame);
  const dt = Math.min(ts - lastTs, 50);
  lastTs = ts;

  const W=cvs.width, H=cvs.height;
  ctx.clearRect(0,0,W,H);

  ctx.save();
  ctx.translate(W/2 + transform.x, H/2 + transform.y);
  ctx.scale(transform.k, transform.k);

  drawLinks();
  updateAndDrawParticles(dt);
  drawNodes(dt);

  ctx.restore();
}
requestAnimationFrame(frame);

// ── Draw links ────────────────────────────────────────────────────────────────
function drawLinks() {
  for (let i=0;i<RAW_LINKS.length;i++) {
    const l = RAW_LINKS[i];
    const s = l.source, t = l.target;
    if (!s||!t||s.x==null||t.x==null) continue;
    if (hiddenComm.has(s.community)||hiddenComm.has(t.community)) continue;

    const isHL  = selectedId && neighborLinks.has(i);
    const isDim = selectedId && !neighborLinks.has(i);
    const isInf = l.confidence==="INFERRED";

    if (isDim) {
      ctx.globalAlpha = 0.03;
    } else if (isHL) {
      ctx.globalAlpha = 0.9;
    } else {
      ctx.globalAlpha = 0.15;
    }

    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(t.x, t.y);

    if (isHL) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth   = 1.8/transform.k;
      ctx.shadowColor = "#ffffff";
      ctx.shadowBlur  = 6;
    } else {
      ctx.strokeStyle = isInf ? "#aa88ff" : s.color;
      ctx.lineWidth   = 0.8/transform.k;
      ctx.shadowBlur  = 0;
    }

    if (isInf) {
      ctx.setLineDash([3,5]);
    } else {
      ctx.setLineDash([]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
}

// ── Particles ────────────────────────────────────────────────────────────────
function updateAndDrawParticles(dt) {
  for (let i = particles.length-1; i>=0; i--) {
    const p = particles[i];
    p.p += p.speed;
    if (p.p >= 1) {
      pulseNode(p.t.id, 500);
      particles.splice(i,1);
      continue;
    }
    const x = p.s.x + (p.t.x - p.s.x)*p.p;
    const y = p.s.y + (p.t.y - p.s.y)*p.p;

    // trail
    p.trail.push({x,y});
    if (p.trail.length > 8) p.trail.shift();

    // draw trail
    for (let j=0;j<p.trail.length;j++) {
      const alpha = (j/p.trail.length)*0.5;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(p.trail[j].x, p.trail[j].y, (p.size*.5)/transform.k, 0, Math.PI*2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }

    // head glow
    ctx.globalAlpha = 1;
    ctx.shadowColor = p.color;
    ctx.shadowBlur  = 12;
    ctx.beginPath();
    ctx.arc(x, y, p.size/transform.k, 0, Math.PI*2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
}

// ── Nodes ────────────────────────────────────────────────────────────────────
function drawNodes(dt) {
  // update pulses
  pulseMap.forEach((ps, id) => {
    ps.t += dt;
    if (ps.t >= ps.maxT) pulseMap.delete(id);
  });

  for (const n of RAW_NODES) {
    if (hiddenComm.has(n.community)) continue;
    if (n.x==null) continue;

    const isSel  = n.id === selectedId;
    const isHov  = n.id === hoveredId;
    const isNB   = selectedId && neighborSet.has(n.id);
    const isDim  = selectedId && !neighborSet.has(n.id) && !isSel;
    const pulse  = pulseMap.get(n.id);
    const pFrac  = pulse ? 1 - pulse.t/pulse.maxT : 0;

    let alpha = isDim ? 0.12 : 1;
    ctx.globalAlpha = alpha;

    const r = n.r / transform.k * (isSel ? 1.5 : isNB ? 1.2 : 1)
            + (pFrac * 4 / transform.k);

    // outer glow
    if (!isDim) {
      const glowR  = r * (isSel ? 5 : isHov ? 4 : pFrac>0.3 ? 3.5 : 2.5);
      const glow   = ctx.createRadialGradient(n.x,n.y,r*.3, n.x,n.y,glowR);
      const gc     = isSel ? "#ffffff" : n.color;
      const gAlpha = isSel ? 0.55 : isHov ? 0.45 : 0.25 + pFrac*.3;
      glow.addColorStop(0, hexA(gc, gAlpha));
      glow.addColorStop(1, hexA(gc, 0));
      ctx.beginPath();
      ctx.arc(n.x, n.y, glowR, 0, Math.PI*2);
      ctx.fillStyle = glow;
      ctx.fill();
    }

    // core circle
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI*2);
    ctx.fillStyle = isSel ? "#ffffff" : n.color;
    ctx.fill();

    // ring for selected/neighbor
    if (isSel) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, r+2/transform.k, 0, Math.PI*2);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth   = 1.5/transform.k;
      ctx.stroke();
    } else if (isNB) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, r+1.5/transform.k, 0, Math.PI*2);
      ctx.strokeStyle = n.color;
      ctx.lineWidth   = 1/transform.k;
      ctx.stroke();
    }

    // label
    const showLabel = isSel || isNB || isHov || (n.degree >= 12 && transform.k > 0.4);
    if (showLabel) {
      ctx.globalAlpha = isDim ? 0.1 : 1;
      ctx.font = `${isSel ? "bold " : ""}${Math.max(9, 11/transform.k)}px sans-serif`;
      ctx.fillStyle = isSel ? "#ffffff" : isNB ? n.color : "#bbccee";
      ctx.shadowColor = "#000000";
      ctx.shadowBlur  = 4;
      ctx.fillText(n.label, n.x + r + 4/transform.k, n.y + 4/transform.k);
      ctx.shadowBlur  = 0;
    }
  }
  ctx.globalAlpha = 1;
}

// ── Selection ────────────────────────────────────────────────────────────────
function selectNode(n) {
  selectedId = n.id;
  neighborSet.clear();
  neighborLinks.clear();
  neighborSet.add(n.id);
  RAW_LINKS.forEach((l,i) => {
    const s = typeof l.source==="object" ? l.source.id : l.source;
    const t = typeof l.target==="object" ? l.target.id : l.target;
    if (s===n.id||t===n.id) {
      neighborSet.add(s); neighborSet.add(t);
      neighborLinks.add(i);
    }
  });
  pulseNode(n.id, 1000);
  // fire signals from this node
  const myLinks = RAW_LINKS.filter(l => {
    const s = typeof l.source==="object" ? l.source.id : l.source;
    const t = typeof l.target==="object" ? l.target.id : l.target;
    return s===n.id||t===n.id;
  }).slice(0,20);
  myLinks.forEach(spawnParticle);

  showInfo(n);
  showNeighbors(n);
  panTo(n);
}

function deselect() {
  selectedId = null;
  neighborSet.clear();
  neighborLinks.clear();
  document.getElementById("info-content").innerHTML = '<span class="empty">Click any node to inspect</span>';
  document.getElementById("nb-section").style.display="none";
}

function panTo(n) {
  const W=cvs.width, H=cvs.height;
  const targetX = -n.x * transform.k;
  const targetY = -n.y * transform.k;
  const startX = transform.x, startY = transform.y;
  const t0 = performance.now();
  function anim(t) {
    const frac = Math.min(1, (t-t0)/500);
    const ease = 1-Math.pow(1-frac,3);
    transform.x = startX + (targetX-startX)*ease;
    transform.y = startY + (targetY-startY)*ease;
    if (frac<1) requestAnimationFrame(anim);
  }
  requestAnimationFrame(anim);
}

// ── Info panel ────────────────────────────────────────────────────────────────
function showInfo(n) {
  const sf = n.sf || "—";
  document.getElementById("info-content").innerHTML = `
    <div class="field"><b>Name</b><div class="val">${esc(n.label)}</div></div>
    <div class="field"><b>File</b><div class="val">${esc(sf)}</div></div>
    <div class="field"><b>Location</b> <span class="val">${esc(n.loc||"—")}</span></div>
    <div class="field"><b>Type</b> <span class="val">${esc(n.ftype||"code")}</span></div>
    <div class="field"><b>Connections</b> <span class="val">${n.degree}</span></div>
    <div class="field"><span class="badge" style="background:${n.color}22;color:${n.color};border:1px solid ${n.color}55">Community ${n.community}</span></div>
  `;
}

function showNeighbors(n) {
  const sec  = document.getElementById("nb-section");
  const list = document.getElementById("nb-list");
  const nbs  = adjMap.get(n.id)||[];
  document.getElementById("nb-cnt").textContent = nbs.length;
  list.innerHTML = nbs.slice(0,50).map(e => {
    const nb = nodeById.get(e.nb);
    if (!nb) return "";
    const arr = e.dir==="out" ? "→" : "←";
    return `<div class="nb-item" onclick="jumpTo('${nb.id}')" style="border-left-color:${nb.color}">
      <span class="nb-dot" style="background:${nb.color}"></span>
      <span class="nb-lbl" title="${esc(nb.label)}">${esc(nb.label)}</span>
      <span class="nb-rel">${arr} ${esc(e.rel)}</span>
    </div>`;
  }).join("");
  sec.style.display="block";
}

function jumpTo(id) {
  const n = nodeById.get(id);
  if (n) selectNode(n);
}

// ── Tooltip ───────────────────────────────────────────────────────────────────
const tip = document.getElementById("tip");
function updateTooltip(n, e) {
  if (!n || n.id===selectedId) { tip.style.opacity=0; return; }
  tip.innerHTML = `<b>${esc(n.label)}</b><br><span style="color:#667;font-size:10px">${esc(n.sf)}</span><br><span style="color:#445;font-size:10px">degree: ${n.degree}</span>`;
  tip.style.opacity=1;
  tip.style.left=(e.clientX+14)+"px";
  tip.style.top=(e.clientY+14)+"px";
}

// ── Search ────────────────────────────────────────────────────────────────────
const searchEl = document.getElementById("search");
const resEl    = document.getElementById("results-list");
searchEl.addEventListener("input", () => {
  const q = searchEl.value.trim().toLowerCase();
  if (!q) { resEl.style.display="none"; resEl.innerHTML=""; return; }
  const hits = RAW_NODES.filter(n=>n.label.toLowerCase().includes(q)).slice(0,12);
  if (!hits.length) { resEl.style.display="none"; return; }
  resEl.innerHTML = hits.map(n=>`<div class="result-item" onclick="jumpTo('${n.id}')">${esc(n.label)}</div>`).join("");
  resEl.style.display="block";
});
document.addEventListener("click", e => {
  if (!searchEl.contains(e.target) && !resEl.contains(e.target))
    resEl.style.display="none";
});

// ── Legend ────────────────────────────────────────────────────────────────────
document.getElementById("legend").innerHTML = LEGEND.map(l=>
  `<div class="lg-item" id="lg-${l.cid}" onclick="toggleComm(${l.cid})">
    <span class="lg-dot" style="background:${l.color}"></span>
    <span class="lg-lbl">Community ${l.cid}</span>
    <span class="lg-cnt">${l.count}</span>
  </div>`
).join("");

function toggleComm(cid) {
  if (hiddenComm.has(cid)) hiddenComm.delete(cid);
  else hiddenComm.add(cid);
  document.getElementById("lg-"+cid)?.classList.toggle("off");
}

// ── Controls ──────────────────────────────────────────────────────────────────
function resetView() {
  const t0=performance.now(), sx=transform.x, sy=transform.y, sk=transform.k;
  function a(t) {
    const f=Math.min(1,(t-t0)/600), e=1-Math.pow(1-f,3);
    transform.x=sx*(1-e); transform.y=sy*(1-e); transform.k=sk+(0.55-sk)*e;
    if(f<1) requestAnimationFrame(a);
  }
  requestAnimationFrame(a);
}
function toggleSim() {
  simPaused=!simPaused;
  document.getElementById("pause-btn").textContent = simPaused ? "▶ Run" : "⏸ Pause";
  if (!simPaused) sim.alpha(0.1).restart();
  else sim.stop();
}
function showAll() {
  hiddenComm.clear();
  document.querySelectorAll(".lg-item").forEach(el=>el.classList.remove("off"));
  deselect();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function hexA(hex, alpha) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Boot ──────────────────────────────────────────────────────────────────────
resize();
setTimeout(resetView, 900);
</script>
</body>
</html>
"""

out = Path("graphify-out/mindmap.html")
out.write_text(HTML, encoding="utf-8")
print(f"Written {out}  ({out.stat().st_size//1024} KB)")
