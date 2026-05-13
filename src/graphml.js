// graphml.js — minimal GraphML parser + serializer.
// Browser-native, no dependencies.

const MAX_NODES = 100;

// ── parse ──
// Returns { N, edges: [{u, v}], originalIds: [...] } or throws Error with a
// user-friendly message.
export function parseGraphML(text) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'application/xml');
  const parseErr = doc.querySelector('parsererror');
  if (parseErr) {
    throw new Error('File is not valid XML.');
  }

  const graphEl = doc.querySelector('graph');
  if (!graphEl) {
    throw new Error('No <graph> element found. Is this a GraphML file?');
  }

  const nodeEls = graphEl.querySelectorAll(':scope > node');
  if (nodeEls.length === 0) {
    throw new Error('No <node> elements found in the graph.');
  }
  if (nodeEls.length > MAX_NODES) {
    throw new Error(`Too many nodes: ${nodeEls.length}. The maximum is ${MAX_NODES}.`);
  }

  const idToIndex = new Map();
  const originalIds = [];
  nodeEls.forEach((nodeEl, i) => {
    const id = nodeEl.getAttribute('id');
    if (!id) throw new Error(`Node #${i + 1} is missing an id attribute.`);
    if (idToIndex.has(id)) throw new Error(`Duplicate node id: "${id}".`);
    idToIndex.set(id, i);
    originalIds.push(id);
  });

  const edgeEls = graphEl.querySelectorAll(':scope > edge');
  const edges = [];
  const seen = new Set();
  edgeEls.forEach((edgeEl, i) => {
    const src = edgeEl.getAttribute('source');
    const tgt = edgeEl.getAttribute('target');
    if (!src || !tgt) throw new Error(`Edge #${i + 1} is missing source/target.`);
    if (!idToIndex.has(src)) throw new Error(`Edge #${i + 1} references unknown node "${src}".`);
    if (!idToIndex.has(tgt)) throw new Error(`Edge #${i + 1} references unknown node "${tgt}".`);
    const u = idToIndex.get(src);
    const v = idToIndex.get(tgt);
    if (u === v) return; // skip self-loops silently
    const key = u < v ? `${u}-${v}` : `${v}-${u}`;
    if (seen.has(key)) return; // skip duplicate edges
    seen.add(key);
    edges.push({ u, v, wrap: null });
  });

  return { N: nodeEls.length, edges, originalIds };
}

// ── serialize ──
// Writes a GraphML XML string for the given graph. Node IDs become "n1".."nN".
export function serializeGraphML({ N, edges }) {
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<graphml xmlns="http://graphml.graphdrawing.org/xmlns"');
  lines.push('         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
  lines.push('         xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns');
  lines.push('         http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd">');
  lines.push('  <graph id="G" edgedefault="undirected">');
  for (let i = 0; i < N; i++) {
    lines.push(`    <node id="n${i + 1}"/>`);
  }
  edges.forEach((e, i) => {
    lines.push(`    <edge id="e${i + 1}" source="n${e.u + 1}" target="n${e.v + 1}"/>`);
  });
  lines.push('  </graph>');
  lines.push('</graphml>');
  return lines.join('\n');
}
