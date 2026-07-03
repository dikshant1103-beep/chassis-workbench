"""
Build the graphify knowledge graph for the Moter_bike project.
Uses cached AST extractions from graphify-out/.cache/
"""
import json
import sys
from pathlib import Path

ROOT = Path("/home/dikshant/Desktop/Moter_bike")
OUT  = ROOT / "graphify-out"

# ── 1. Load cached extractions ────────────────────────────────────────────────
print("Loading cached extractions...")
cache_dir = OUT / ".cache"
extractions = []
for f in sorted(cache_dir.glob("*.json")):
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
        extractions.append(data)
    except Exception as e:
        print(f"  skip {f.name}: {e}")

print(f"  Loaded {len(extractions)} cached files")

# ── 2. Build graph ────────────────────────────────────────────────────────────
print("Building graph...")
from graphify.build import build
G = build(extractions, directed=True)
print(f"  {G.number_of_nodes()} nodes · {G.number_of_edges()} edges")

# ── 3. Cluster ────────────────────────────────────────────────────────────────
print("Clustering communities...")
from graphify.cluster import cluster, score_all
communities = cluster(G)
cohesion    = score_all(G, communities)
print(f"  {len(communities)} communities detected")

# ── 4. Analyze ────────────────────────────────────────────────────────────────
print("Analyzing graph...")
from graphify.analyze import god_nodes, surprising_connections, suggest_questions

gods      = god_nodes(G)
surprises = surprising_connections(G, communities)
labels    = {cid: f"Community {cid}" for cid in communities}
questions = suggest_questions(G, communities, labels)
print(f"  {len(gods)} god nodes · {len(surprises)} surprising connections · {len(questions)} questions")

# ── 5. Detection result ───────────────────────────────────────────────────────
src_files = {
    data.get("source_file", "")
    for _, data in G.nodes(data=True)
    if data.get("source_file", "")
}
total_words = sum(
    len(data.get("label", "").split())
    for _, data in G.nodes(data=True)
)
detection_result = {
    "total_files": len(src_files),
    "total_words": total_words,
    "warning": None,
}

# ── 6. Token cost ─────────────────────────────────────────────────────────────
total_in  = sum(e.get("input_tokens",  0) for e in extractions)
total_out = sum(e.get("output_tokens", 0) for e in extractions)
tokens = {"input": total_in, "output": total_out}

# ── 7. Write GRAPH_REPORT.md ──────────────────────────────────────────────────
print("Writing GRAPH_REPORT.md...")
from graphify.report import generate
report = generate(
    G, communities, cohesion, labels, gods, surprises,
    detection_result, tokens, str(ROOT),
    suggested_questions=questions,
)
(OUT / "GRAPH_REPORT.md").write_text(report, encoding="utf-8")
print(f"  Written: {OUT / 'GRAPH_REPORT.md'}")

# ── 8. Write graph.json ───────────────────────────────────────────────────────
print("Writing graph.json...")
from graphify.export import to_json
graph_data = to_json(G, communities, cohesion, labels)
(OUT / "graph.json").write_text(json.dumps(graph_data, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"  Written: {OUT / 'graph.json'}")

# ── 9. Summary ────────────────────────────────────────────────────────────────
print()
print("=" * 60)
print("Knowledge graph built successfully!")
print(f"  Nodes      : {G.number_of_nodes()}")
print(f"  Edges      : {G.number_of_edges()}")
print(f"  Communities: {len(communities)}")
print(f"  God nodes  : {[g['label'] for g in gods[:5]]}")
print(f"  Tokens used: {total_in:,} in / {total_out:,} out")
print(f"  Output dir : {OUT}")
print()
print("Top god nodes:")
for i, g in enumerate(gods[:10], 1):
    print(f"  {i:2}. {g['label']} ({g['degree']} edges)")
print()
print("Surprising connections:")
for s in surprises[:5]:
    print(f"  {s['source']} --{s['relation']}--> {s['target']}")
    print(f"    {s.get('why','')}")
