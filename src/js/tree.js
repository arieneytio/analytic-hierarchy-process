/* tree.js — criteria hierarchy model for AHP
 * Builds on window.AHP for matrix analysis. Exposed on window.AHPTree.
 *
 * A node is: { id: string, name: string, children: Node[] }.
 * The root represents the goal; its descendants are criteria / sub-criteria.
 * Leaves (no children) are the levels alternatives are compared against.
 */
(function (global) {
  "use strict";

  /** Depth-first visit of every node (root included). cb(node, parent, depth). */
  function walk(root, cb) {
    (function rec(node, parent, depth) {
      cb(node, parent, depth);
      (node.children || []).forEach((c) => rec(c, node, depth + 1));
    })(root, null, 0);
  }

  /** All leaf nodes (no children), excluding the root unless the tree is empty. */
  function leaves(root) {
    const out = [];
    walk(root, (node) => {
      if (node !== root && (!node.children || node.children.length === 0)) {
        out.push(node);
      }
    });
    return out;
  }

  /** All internal nodes that own a comparison matrix (root + nodes with children). */
  function internals(root) {
    const out = [];
    walk(root, (node) => {
      if (node.children && node.children.length > 0) out.push(node);
    });
    return out;
  }

  /** Find a node by id (searches the whole tree including root). */
  function findById(root, id) {
    let found = null;
    walk(root, (node) => { if (node.id === id) found = node; });
    return found;
  }

  /** Remove the node with the given id (cannot remove the root). Returns true if removed. */
  function removeById(root, id) {
    let removed = false;
    walk(root, (node) => {
      if (!node.children) return;
      const idx = node.children.findIndex((c) => c.id === id);
      if (idx !== -1) {
        node.children.splice(idx, 1);
        removed = true;
      }
    });
    return removed;
  }

  /** Names from the first level down to the node (root excluded). e.g. ["Cost", "Upfront"]. */
  function pathNames(root, id) {
    const path = [];
    (function rec(node, trail) {
      const next = node === root ? trail : trail.concat(node.name);
      if (node.id === id) { path.push(...next); return true; }
      return (node.children || []).some((c) => rec(c, next));
    })(root, []);
    return path;
  }

  /** Human-readable path string, e.g. "Cost › Upfront". */
  function pathLabel(root, id) {
    return pathNames(root, id).join(" › ");
  }

  /**
   * Propagate weights through the hierarchy.
   * @param {Node} root
   * @param {Object<string, number[][]>} criteriaMatrices  internalNodeId -> matrix over its children
   * @returns {Object<string, {local:number, global:number, analysis?:object}>}
   *          keyed by node id. local = weight within its parent; global = product down the path.
   */
  function computeWeights(root, criteriaMatrices) {
    const AHP = global.AHP;
    const out = {};
    out[root.id] = { local: 1, global: 1 };

    (function rec(node) {
      const kids = node.children || [];
      if (kids.length === 0) return;

      let weights;
      let analysis = null;
      if (kids.length === 1) {
        weights = [1];
        analysis = { weights: [1], lambdaMax: 1, ci: 0, ri: 0, cr: 0, consistent: true };
      } else {
        const matrix = criteriaMatrices[node.id] || AHP.identityComparison(kids.length);
        analysis = AHP.analyze(matrix);
        weights = analysis.weights;
      }
      out[node.id].analysis = analysis;

      const parentGlobal = out[node.id].global;
      kids.forEach((child, i) => {
        out[child.id] = {
          local: weights[i],
          global: parentGlobal * weights[i],
        };
        rec(child);
      });
    })(root);

    return out;
  }

  global.AHPTree = {
    walk,
    leaves,
    internals,
    findById,
    removeById,
    pathNames,
    pathLabel,
    computeWeights,
  };
})(window);
