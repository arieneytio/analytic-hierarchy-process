/* ahp.js — Analytic Hierarchy Process matrix math
 * Pure functions, no DOM. Exposed on window.AHP.
 */
(function (global) {
  "use strict";

  // Saaty Random Index by matrix order n (index = n).
  const RANDOM_INDEX = [0, 0, 0, 0.58, 0.90, 1.12, 1.24, 1.32, 1.41, 1.45, 1.49, 1.51, 1.48, 1.56, 1.57, 1.59];

  /** Build an n×n reciprocal matrix initialised to all-equal (1s). */
  function identityComparison(n) {
    const m = [];
    for (let i = 0; i < n; i++) {
      m.push(new Array(n).fill(1));
    }
    return m;
  }

  /** Set m[i][j]=v and the reciprocal m[j][i]=1/v, keeping the diagonal at 1. */
  function setPair(matrix, i, j, value) {
    if (i === j) return;
    matrix[i][j] = value;
    matrix[j][i] = 1 / value;
  }

  /**
   * Principal eigenvector via power iteration.
   * Returns { weights, lambdaMax }.
   * weights are normalised to sum 1; lambdaMax is the principal eigenvalue.
   */
  function principalEigen(matrix) {
    const n = matrix.length;
    if (n === 0) return { weights: [], lambdaMax: 0 };
    if (n === 1) return { weights: [1], lambdaMax: 1 };

    let v = new Array(n).fill(1 / n);

    // Iterate to machine precision so the eigenvector carries full double-precision
    // accuracy (≈15–16 significant digits) — no intermediate rounding.
    for (let iter = 0; iter < 1000; iter++) {
      const next = new Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = 0; j < n; j++) sum += matrix[i][j] * v[j];
        next[i] = sum;
      }
      const total = next.reduce((a, b) => a + b, 0);
      if (total === 0) break;
      for (let i = 0; i < n; i++) next[i] /= total;

      // Convergence check on the weight vector.
      let delta = 0;
      for (let i = 0; i < n; i++) delta += Math.abs(next[i] - v[i]);
      v = next;
      if (delta < 1e-15) break;
    }

    // lambdaMax = average of (A·v)_i / v_i.
    let acc = 0;
    let counted = 0;
    for (let i = 0; i < n; i++) {
      let row = 0;
      for (let j = 0; j < n; j++) row += matrix[i][j] * v[j];
      if (v[i] > 0) {
        acc += row / v[i];
        counted++;
      }
    }
    const lambda = counted ? acc / counted : n;

    return { weights: v, lambdaMax: lambda };
  }

  /**
   * Full consistency analysis of a comparison matrix.
   * Priorities are the principal eigenvector (power iteration to machine precision).
   * Returns { weights, lambdaMax, ci, ri, cr, consistent }.
   */
  function analyze(matrix) {
    const n = matrix.length;
    const { weights, lambdaMax } = principalEigen(matrix);
    const ci = n > 1 ? (lambdaMax - n) / (n - 1) : 0;
    const ri = RANDOM_INDEX[n] !== undefined ? RANDOM_INDEX[n] : 1.59;
    const cr = ri > 0 ? ci / ri : 0;
    return {
      weights,
      lambdaMax,
      ci,
      ri,
      cr,
      consistent: cr <= 0.1,
    };
  }

  /**
   * Element-wise geometric mean of several reciprocal comparison matrices.
   * This is AHP's standard group-aggregation of individual judgements (AIJ);
   * the geometric mean of reciprocals is itself reciprocal, so the result is a
   * valid comparison matrix. Missing/empty inputs are ignored.
   * @param {number[][][]} matrices array of n×n matrices
   * @returns {number[][]} aggregated n×n matrix (empty if no valid inputs)
   */
  function geomMeanMatrices(matrices) {
    const valid = (matrices || []).filter((m) => Array.isArray(m) && m.length > 0);
    if (valid.length === 0) return [];
    if (valid.length === 1) return valid[0];
    const n = valid[0].length;
    const out = identityComparison(n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) { out[i][j] = 1; continue; }
        let logSum = 0;
        let count = 0;
        for (const m of valid) {
          if (m[i] && m[i][j] > 0) { logSum += Math.log(m[i][j]); count++; }
        }
        out[i][j] = count ? Math.exp(logSum / count) : 1;
      }
    }
    return out;
  }

  /**
   * Aggregate alternative scores from leaf global weights.
   * @param {number[]} leafWeights global weight per leaf (sums to ~1)
   * @param {number[][]} altWeightsPerLeaf array length L, each length A
   * @returns {number[]} final score per alternative (length A), summing to ~1
   */
  function aggregate(leafWeights, altWeightsPerLeaf) {
    const L = leafWeights.length;
    if (L === 0) return [];
    const A = altWeightsPerLeaf[0] ? altWeightsPerLeaf[0].length : 0;
    const scores = new Array(A).fill(0);
    for (let l = 0; l < L; l++) {
      const w = leafWeights[l];
      const col = altWeightsPerLeaf[l] || [];
      for (let a = 0; a < A; a++) {
        scores[a] += w * (col[a] || 0);
      }
    }
    return scores;
  }

  global.AHP = {
    RANDOM_INDEX,
    identityComparison,
    setPair,
    principalEigen,
    analyze,
    geomMeanMatrices,
    aggregate,
  };
})(window);
