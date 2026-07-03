"""
Generate an interactive D3.js force-directed mind map of the Moter_bike project graph.
"""
import json, html, math
from pathlib import Path
from collections import defaultdict

raw   = json.loads(Path("graphify-out/graph.json").read_text(encoding="utf-8"))
nodes = raw["nodes"]   # list of dicts with id, label, source_file, community, ...
links = raw["links"]   # list of dicts with source, target, relation, confidence

# ── Community colours (same palette as graphify) ──────────────────────────────
PALETTE = [
    "#4E79A7","#F28E2B","#E15759","#76B7B2","#59A14F",
    "#EDC948","#B07AA1","#FF9DA7","#9C755F","#BAB0AC",
    "#86BCB6","#FF7F7F","#AECDE8","#FFBE7D","#A0CBE8",
    "#8CD17D","#B6992D","#499894","#E15759","#79706E",
]

# Build community sizes for legend
comm_sizes: dict[int, int] = defaultdict(int)
for n in nodes:
    cid = n.get("community", 0)
    if isinstance(cid, int):
        comm_sizes[cid] += 1

# Compute degree for sizing
degree: dict[str, int] = defaultdict(int)
for lnk in links:
    degree[lnk["source"]] += 1
    degree[lnk["target"]] += 1

max_deg = max(degree.values(), default=1) or 1

# Trim label for display (long docstring labels → short)
def short_label(label: str) -> str:
    l = label.strip().replace("\n", " ")
    return l[:40] + "…" if len(l) > 40 else l

# Prepare node objects for D3
d3_nodes = []
for n in nodes:
    nid  = n["id"]
    cid  = n.get("community", 0) if isinstance(n.get("community"), int) else 0
    deg  = degree.get(nid, 1)
    size = max(4, min(28, 4 + 24 * (deg / max_deg)))
    d3_nodes.append({
        "id":          nid,
        "label":       short_label(n.get("label", nid)),
        "full_label":  n.get("label", nid),
        "source_file": n.get("source_file", ""),
        "location":    n.get("source_location", ""),
        "file_type":   n.get("file_type", ""),
        "community":   cid,
        "color":       PALETTE[cid % len(PALETTE)],
        "degree":      deg,
        "size":        round(size, 1),
    })

# Prepare link objects
d3_links = []
for lnk in links:
    d3_links.append({
        "source":     lnk["source"],
        "target":     lnk["target"],
        "relation":   lnk.get("relation", ""),
        "confidence": lnk.get("confidence", "EXTRACTED"),
    })

# Community legend entries (top 20 by size)
top_comms = sorted(comm_sizes.items(), key=lambda x: -x[1])[:20]
legend = [{"cid": cid, "color": PALETTE[cid % len(PALETTE)], "count": cnt}
          for cid, cnt in top_comms]

nodes_js = json.dumps(d3_nodes).replace("</", "<\\/")
links_js = json.dumps(d3_links).replace("</", "<\\/")
legend_js = json.dumps(legend).replace("</", "<\\/")
stats_txt = f"{len(nodes)} nodes · {len(links)} edges · {len(comm_sizes)} communities"

HTML = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Moter_bike — Knowledge Mind Map</title>
<script src="https://d3js.org/d3.v7.min.js"></script>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{background:#0d0d1a;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;height:100vh;overflow:hidden}}
#canvas-wrap{{flex:1;position:relative;overflow:hidden}}
svg{{width:100%;height:100%;cursor:grab}}
svg.dragging{{cursor:grabbing}}

/* edges */
.link{{stroke-opacity:0.45;stroke-width:1.2px}}
.link.extracted{{stroke:#5588aa}}
.link.inferred{{stroke:#7a6fa0;stroke-dasharray:4,3}}
.link.ambiguous{{stroke:#cc8844;stroke-dasharray:2,4}}
.link.highlighted{{stroke:#ffffff;stroke-opacity:1;stroke-width:2px}}
.link.dimmed{{stroke-opacity:0.05}}

/* nodes */
.node circle{{stroke:#111;stroke-width:1px;cursor:pointer;transition:filter .15s}}
.node circle:hover{{filter:brightness(1.5)}}
.node.selected circle{{stroke:#fff;stroke-width:2.5px;filter:brightness(1.4)}}
.node.dimmed circle{{opacity:0.12}}

/* labels */
.node text{{pointer-events:none;user-select:none;fill:#ddd;font-size:11px;text-shadow:0 0 4px #000}}
.node.selected text{{fill:#fff;font-weight:600}}

/* sidebar */
#sidebar{{width:300px;background:#12122a;border-left:1px solid #252550;display:flex;flex-direction:column;overflow:hidden;z-index:10}}
#search-wrap{{padding:12px;border-bottom:1px solid #252550}}
#search{{width:100%;background:#0d0d1a;border:1px solid #3a3a6e;color:#e0e0e0;padding:8px 12px;border-radius:6px;font-size:13px;outline:none}}
#search:focus{{border-color:#4E79A7}}
#results-list{{max-height:160px;overflow-y:auto;padding:4px 12px;border-bottom:1px solid #252550;display:none}}
.result-item{{padding:5px 6px;cursor:pointer;border-radius:4px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
.result-item:hover{{background:#1e1e40}}

#info-panel{{padding:14px;border-bottom:1px solid #252550;min-height:180px}}
#info-panel h3{{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px}}
.field{{margin-bottom:7px;font-size:12px;line-height:1.5}}
.field b{{color:#aac}}
.field .val{{color:#ddd;word-break:break-word}}
.badge{{display:inline-block;padding:2px 7px;border-radius:10px;font-size:10px;margin-top:4px;font-weight:600}}
.empty{{color:#444;font-style:italic;font-size:12px}}

#neighbors-section{{padding:10px 14px;border-bottom:1px solid #252550;max-height:200px;overflow-y:auto}}
#neighbors-section h3{{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px}}
.nb-item{{padding:4px 8px;margin:2px 0;border-radius:4px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:8px;border-left:3px solid #333}}
.nb-item:hover{{background:#1e1e40}}
.nb-dot{{width:9px;height:9px;border-radius:50%;flex-shrink:0}}
.nb-label{{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
.nb-rel{{color:#666;font-size:10px}}

#legend-section{{flex:1;overflow-y:auto;padding:12px}}
#legend-section h3{{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px}}
.legend-item{{display:flex;align-items:center;gap:8px;padding:4px 4px;cursor:pointer;border-radius:4px;font-size:12px}}
.legend-item:hover{{background:#1e1e40}}
.legend-item.dimmed{{opacity:.3}}
.ld{{width:12px;height:12px;border-radius:50%;flex-shrink:0}}
.lcount{{color:#555;font-size:10px;margin-left:auto}}

#stats-bar{{padding:8px 14px;border-top:1px solid #252550;font-size:10px;color:#444}}

/* controls */
#controls{{position:absolute;bottom:16px;left:16px;display:flex;gap:8px;z-index:20}}
.ctrl-btn{{background:#12122a;border:1px solid #3a3a6e;color:#aaa;padding:7px 14px;border-radius:6px;cursor:pointer;font-size:12px}}
.ctrl-btn:hover{{background:#1e1e40;color:#fff}}

/* tooltip */
#tooltip{{position:absolute;background:#12122acc;border:1px solid #3a3a6e;padding:8px 12px;border-radius:6px;font-size:12px;pointer-events:none;opacity:0;transition:opacity .15s;max-width:280px;z-index:30;color:#e0e0e0}}
</style>
</head>
<body>

<div id="canvas-wrap">
  <svg id="svg">
    <defs>
      <marker id="arrow" viewBox="0 -4 8 8" refX="18" refY="0"
              markerWidth="5" markerHeight="5" orient="auto">
        <path d="M0,-4L8,0L0,4" fill="#5588aa" opacity="0.6"/>
      </marker>
      <marker id="arrow-hl" viewBox="0 -4 8 8" refX="18" refY="0"
              markerWidth="5" markerHeight="5" orient="auto">
        <path d="M0,-4L8,0L0,4" fill="#ffffff"/>
      </marker>
    </defs>
    <g id="root">
      <g id="links-layer"></g>
      <g id="nodes-layer"></g>
    </g>
  </svg>
  <div id="tooltip"></div>
  <div id="controls">
    <button class="ctrl-btn" onclick="resetZoom()">⌂ Reset</button>
    <button class="ctrl-btn" onclick="togglePhysics()">⏸ Pause</button>
    <button class="ctrl-btn" onclick="showAll()">☀ Show all</button>
  </div>
</div>

<div id="sidebar">
  <div id="search-wrap">
    <input id="search" placeholder="🔍 Search nodes…" autocomplete="off">
    <div id="results-list"></div>
  </div>
  <div id="info-panel">
    <h3>Node Inspector</h3>
    <div id="info-content"><span class="empty">Click any node to inspect it</span></div>
  </div>
  <div id="neighbors-section" style="display:none">
    <h3>Connections (<span id="nb-count">0</span>)</h3>
    <div id="neighbors-list"></div>
  </div>
  <div id="legend-section">
    <h3>Communities</h3>
    <div id="legend"></div>
  </div>
  <div id="stats-bar">{stats_txt}</div>
</div>

<script>
const NODES = {nodes_js};
const LINKS = {links_js};
const LEGEND = {legend_js};

// ── index lookups ─────────────────────────────────────────────────────────────
const nodeById = new Map(NODES.map(n => [n.id, n]));

// adjacency: for each node id → array of {{neighbor, relation, confidence, dir}}
const adj = new Map(NODES.map(n => [n.id, []]));
LINKS.forEach(l => {{
  adj.get(l.source)?.push({{nb: l.target, relation: l.relation, confidence: l.confidence, dir:"out"}});
  adj.get(l.target)?.push({{nb: l.source, relation: l.relation, confidence: l.confidence, dir:"in"}});
}});

// ── D3 setup ──────────────────────────────────────────────────────────────────
const svg    = d3.select("#svg");
const root   = svg.select("#root");
const linksG = root.select("#links-layer");
const nodesG = root.select("#nodes-layer");
const tooltip = document.getElementById("tooltip");

const W = () => document.getElementById("canvas-wrap").clientWidth;
const H = () => document.getElementById("canvas-wrap").clientHeight;

// zoom
const zoom = d3.zoom()
  .scaleExtent([0.05, 4])
  .on("zoom", e => root.attr("transform", e.transform));
svg.call(zoom);

svg.on("mousedown", () => svg.classed("dragging", true))
   .on("mouseup",   () => svg.classed("dragging", false));

// ── Simulation ────────────────────────────────────────────────────────────────
let simRunning = true;
const sim = d3.forceSimulation(NODES)
  .force("link",    d3.forceLink(LINKS).id(d => d.id).distance(80).strength(0.4))
  .force("charge",  d3.forceManyBody().strength(-220).distanceMax(400))
  .force("center",  d3.forceCenter(W()/2, H()/2))
  .force("collide", d3.forceCollide(d => d.size + 4))
  .alphaDecay(0.015);

// ── Draw edges ────────────────────────────────────────────────────────────────
const linkSel = linksG.selectAll("line")
  .data(LINKS)
  .join("line")
  .attr("class", d => "link " + (d.confidence || "extracted").toLowerCase())
  .attr("marker-end", "url(#arrow)");

// ── Draw nodes ────────────────────────────────────────────────────────────────
const nodeSel = nodesG.selectAll("g.node")
  .data(NODES)
  .join("g")
  .attr("class", "node")
  .call(d3.drag()
    .on("start", dragStart)
    .on("drag",  dragging)
    .on("end",   dragEnd))
  .on("click",      (e, d) => {{ e.stopPropagation(); selectNode(d); }})
  .on("mouseover",  (e, d) => showTooltip(e, d))
  .on("mousemove",  (e)    => moveTooltip(e))
  .on("mouseout",   ()     => hideTooltip());

nodeSel.append("circle")
  .attr("r", d => d.size)
  .attr("fill", d => d.color);

// labels only for high-degree nodes initially
nodeSel.append("text")
  .text(d => d.label)
  .attr("x", d => d.size + 4)
  .attr("y", 4)
  .style("display", d => d.degree >= 8 ? "block" : "none");

// click on background → deselect
svg.on("click", deselect);

// ── Tick ──────────────────────────────────────────────────────────────────────
sim.on("tick", () => {{
  linkSel
    .attr("x1", d => d.source.x)
    .attr("y1", d => d.source.y)
    .attr("x2", d => d.target.x)
    .attr("y2", d => d.target.y);
  nodeSel.attr("transform", d => `translate(${{d.x}},${{d.y}})`);
}});

// ── Drag handlers ─────────────────────────────────────────────────────────────
function dragStart(e, d) {{
  if (!e.active) sim.alphaTarget(0.25).restart();
  d.fx = d.x; d.fy = d.y;
}}
function dragging(e, d) {{
  d.fx = e.x; d.fy = e.y;
}}
function dragEnd(e, d) {{
  if (!e.active) sim.alphaTarget(0);
  d.fx = null; d.fy = null;
}}

// ── Selection / highlight ─────────────────────────────────────────────────────
let selectedId = null;
let hiddenComms = new Set();

function selectNode(d) {{
  selectedId = d.id;
  const neighbors = new Set([d.id]);
  const neighborLinks = new Set();
  LINKS.forEach((l, i) => {{
    const sid = typeof l.source === "object" ? l.source.id : l.source;
    const tid = typeof l.target === "object" ? l.target.id : l.target;
    if (sid === d.id || tid === d.id) {{
      neighbors.add(sid);
      neighbors.add(tid);
      neighborLinks.add(i);
    }}
  }});

  nodeSel
    .classed("selected", n => n.id === d.id)
    .classed("dimmed",   n => !neighbors.has(n.id));

  linkSel
    .classed("highlighted", (l, i) => neighborLinks.has(i))
    .classed("dimmed",      (l, i) => !neighborLinks.has(i));

  // show labels for visible nodes
  nodeSel.select("text")
    .style("display", n => (n.degree >= 8 || neighbors.has(n.id)) ? "block" : "none");

  showInfo(d);
  showNeighbors(d);
}}

function deselect() {{
  selectedId = null;
  nodeSel.classed("selected", false).classed("dimmed", false);
  linkSel.classed("highlighted", false).classed("dimmed", false);
  nodeSel.select("text").style("display", n => n.degree >= 8 ? "block" : "none");
  document.getElementById("info-content").innerHTML = '<span class="empty">Click any node to inspect it</span>';
  document.getElementById("neighbors-section").style.display = "none";
}}

// ── Info panel ────────────────────────────────────────────────────────────────
function showInfo(d) {{
  const sf  = d.source_file.replace("/home/dikshant/Desktop/Moter_bike/","");
  const col = d.color;
  const html = `
    <div class="field"><b>Name</b><br><span class="val">${{escH(d.label)}}</span></div>
    <div class="field"><b>File</b><br><span class="val">${{escH(sf || "—")}}</span></div>
    <div class="field"><b>Location</b> <span class="val">${{escH(d.location || "—")}}</span></div>
    <div class="field"><b>Type</b> <span class="val">${{escH(d.file_type || "code")}}</span></div>
    <div class="field"><b>Connections</b> <span class="val">${{d.degree}}</span></div>
    <div class="field"><span class="badge" style="background:${{col}}22;color:${{col}};border:1px solid ${{col}}44">Community ${{d.community}}</span></div>
  `;
  document.getElementById("info-content").innerHTML = html;
}}

function showNeighbors(d) {{
  const section = document.getElementById("neighbors-section");
  const list    = document.getElementById("neighbors-list");
  const nbArr   = adj.get(d.id) || [];
  document.getElementById("nb-count").textContent = nbArr.length;
  list.innerHTML = nbArr.slice(0, 40).map(e => {{
    const nb  = nodeById.get(e.nb);
    if (!nb) return "";
    const arr = e.dir === "out" ? "→" : "←";
    return `<div class="nb-item" onclick="selectNodeById('${{nb.id}}')" style="border-left-color:${{nb.color}}">
      <span class="nb-dot" style="background:${{nb.color}}"></span>
      <span class="nb-label" title="${{escH(nb.label)}}">${{escH(nb.label)}}</span>
      <span class="nb-rel">${{arr}} ${{e.relation}}</span>
    </div>`;
  }}).join("");
  section.style.display = "block";
}}

function selectNodeById(id) {{
  const d = nodeById.get(id);
  if (d) {{
    selectNode(d);
    // pan to node
    const t = d3.zoomTransform(svg.node());
    const x = W()/2 - t.k * d.x;
    const y = H()/2 - t.k * d.y;
    svg.transition().duration(500)
       .call(zoom.transform, d3.zoomIdentity.translate(x,y).scale(t.k));
  }}
}}

// ── Tooltip ───────────────────────────────────────────────────────────────────
function showTooltip(e, d) {{
  const sf = d.source_file.replace("/home/dikshant/Desktop/Moter_bike/","");
  tooltip.innerHTML = `<b>${{escH(d.label)}}</b><br><span style="color:#888;font-size:11px">${{escH(sf)}}</span><br><span style="color:#666;font-size:10px">degree: ${{d.degree}}</span>`;
  tooltip.style.opacity = 1;
  moveTooltip(e);
}}
function moveTooltip(e) {{
  let x = e.clientX + 12, y = e.clientY + 12;
  tooltip.style.left = x + "px";
  tooltip.style.top  = y + "px";
}}
function hideTooltip() {{ tooltip.style.opacity = 0; }}

// ── Search ────────────────────────────────────────────────────────────────────
const searchEl  = document.getElementById("search");
const resultEl  = document.getElementById("results-list");
searchEl.addEventListener("input", () => {{
  const q = searchEl.value.trim().toLowerCase();
  if (!q) {{ resultEl.style.display = "none"; resultEl.innerHTML = ""; return; }}
  const hits = NODES.filter(n => n.label.toLowerCase().includes(q)).slice(0, 15);
  if (!hits.length) {{ resultEl.style.display = "none"; return; }}
  resultEl.innerHTML = hits.map(n =>
    `<div class="result-item" onclick="selectNodeById('${{n.id}}')">${{escH(n.label)}}</div>`
  ).join("");
  resultEl.style.display = "block";
}});
document.addEventListener("click", e => {{
  if (!searchEl.contains(e.target) && !resultEl.contains(e.target))
    resultEl.style.display = "none";
}});

// ── Legend ────────────────────────────────────────────────────────────────────
const legendEl = document.getElementById("legend");
legendEl.innerHTML = LEGEND.map(l =>
  `<div class="legend-item" id="leg-${{l.cid}}" onclick="toggleComm(${{l.cid}})">
    <span class="ld" style="background:${{l.color}}"></span>
    <span>Community ${{l.cid}}</span>
    <span class="lcount">${{l.count}}</span>
  </div>`
).join("");

function toggleComm(cid) {{
  if (hiddenComms.has(cid)) hiddenComms.delete(cid);
  else hiddenComms.add(cid);
  document.getElementById("leg-"+cid)?.classList.toggle("dimmed");
  applyCommFilter();
}}

function applyCommFilter() {{
  nodeSel.style("display", d => hiddenComms.has(d.community) ? "none" : null);
  linkSel.style("display", l => {{
    const sid = typeof l.source==="object" ? l.source.id : l.source;
    const tid = typeof l.target==="object" ? l.target.id : l.target;
    const sn = nodeById.get(sid), tn = nodeById.get(tid);
    return (hiddenComms.has(sn?.community) || hiddenComms.has(tn?.community)) ? "none" : null;
  }});
}}

// ── Controls ──────────────────────────────────────────────────────────────────
function resetZoom() {{
  svg.transition().duration(600)
     .call(zoom.transform, d3.zoomIdentity.translate(W()/2, H()/2).scale(0.55));
}}
function togglePhysics() {{
  simRunning = !simRunning;
  document.querySelector('[onclick="togglePhysics()"]').textContent = simRunning ? "⏸ Pause" : "▶ Run";
  if (simRunning) sim.alphaTarget(0.1).restart();
  else sim.stop();
}}
function showAll() {{
  hiddenComms.clear();
  document.querySelectorAll(".legend-item").forEach(el => el.classList.remove("dimmed"));
  applyCommFilter();
  deselect();
}}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escH(s) {{
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}}

// initial zoom
setTimeout(resetZoom, 800);
</script>
</body>
</html>"""

out = Path("graphify-out/mindmap.html")
out.write_text(HTML, encoding="utf-8")
print(f"Written {out}  ({out.stat().st_size//1024} KB)")
