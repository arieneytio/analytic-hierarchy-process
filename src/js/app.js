/* app.js — UI + state for the AHP Decision Analyzer (with nested sub-criteria) */
(function () {
  "use strict";

  const PROJECTS_KEY = "ahp-projects-v1";   // registry of all projects
  const LEGACY_KEY = "ahp-analyzer-v2";     // single-project key from earlier versions

  // ---- State -------------------------------------------------------------
  // `state` is the live working copy of the *active* project. Each project's
  // data is persisted separately in the registry so switching never loses work.
  const state = {
    goal: "",
    description: "",             // free-text notes for this project
    tree: { id: "root", name: "Goal", children: [] }, // root.children = top-level criteria
    alternatives: [],            // string[]
    // One entry per respondent; each holds that person's judgement matrices:
    //   { id, name, criteriaMatrices: {nodeId->matrix}, altMatrices: {leafId->matrix} }
    respondents: [],
    activeRespondent: null,      // respondent id, or "group" for the aggregated view
    activeCompareKey: null,      // "crit:<nodeId>" | "alt:<leafId>"
    nextId: 1,
    built: false,
  };

  // Saaty verbal descriptors keyed by intensity (1..9).
  const VERBAL = {
    1: "Equal importance",
    2: "Equal to moderate",
    3: "Moderate importance",
    4: "Moderate to strong",
    5: "Strong importance",
    6: "Strong to very strong",
    7: "Very strong importance",
    8: "Very strong to extreme",
    9: "Extreme importance",
  };

  const $ = (id) => document.getElementById(id);

  function newId() {
    return "n" + state.nextId++;
  }

  // ---- Projects + persistence --------------------------------------------
  let projects = [];   // [{ id, name, updatedAt, data }]
  let activeId = null;

  function projectId() {
    return "proj-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36);
  }
  function activeProject() {
    return projects.find((p) => p.id === activeId) || null;
  }
  function blankData() {
    return {
      goal: "", description: "", tree: { id: "root", name: "Goal", children: [] }, alternatives: [],
      respondents: [], activeRespondent: null, activeCompareKey: null, nextId: 1, built: false,
    };
  }
  // Snapshot the live state into a plain object for storage.
  function snapshotState() {
    return {
      goal: state.goal, description: state.description, tree: state.tree, alternatives: state.alternatives,
      respondents: state.respondents, activeRespondent: state.activeRespondent,
      activeCompareKey: state.activeCompareKey, nextId: state.nextId, built: state.built,
    };
  }
  // Normalise a project's data (migrate legacy top-level matrices into a respondent).
  function normalizeData(d) {
    d = d || blankData();
    if (!d.tree) d.tree = { id: "root", name: "Goal", children: [] };
    if (!Array.isArray(d.respondents) || d.respondents.length === 0) {
      d.respondents = [{
        id: "r-1", name: "Respondent 1",
        criteriaMatrices: d.criteriaMatrices || {}, altMatrices: d.altMatrices || {},
      }];
    }
    delete d.criteriaMatrices;
    delete d.altMatrices;
    return d;
  }
  // Load a data object into the live state.
  function applyStateData(d) {
    d = normalizeData(d);
    state.goal = d.goal || "";
    state.description = d.description || "";
    state.tree = d.tree;
    state.alternatives = Array.isArray(d.alternatives) ? d.alternatives : [];
    state.respondents = d.respondents;
    state.activeRespondent = d.activeRespondent || null;
    state.activeCompareKey = d.activeCompareKey || null;
    state.nextId = d.nextId || 1;
    state.built = !!d.built;
  }

  // Persist the whole registry (after syncing the live state into the active slot).
  function save() {
    const p = activeProject();
    if (p) { p.data = snapshotState(); p.updatedAt = Date.now(); }
    try { localStorage.setItem(PROJECTS_KEY, JSON.stringify({ activeId, projects })); } catch (e) { /* ignore */ }
  }

  // Build the in-memory registry from storage (or migrate / seed a first project).
  function loadProjects() {
    let parsed = null;
    try { parsed = JSON.parse(localStorage.getItem(PROJECTS_KEY)); } catch (e) { /* ignore */ }
    if (parsed && Array.isArray(parsed.projects) && parsed.projects.length) {
      projects = parsed.projects;
      activeId = projects.some((p) => p.id === parsed.activeId) ? parsed.activeId : projects[0].id;
      return;
    }
    // Migrate a single-project save from an earlier version.
    let legacy = null;
    try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY)); } catch (e) { /* ignore */ }
    if (legacy && (legacy.tree || legacy.goal || legacy.respondents)) {
      const id = projectId();
      projects = [{ id, name: (legacy.goal || "Imported project").slice(0, 40), updatedAt: Date.now(), data: legacy }];
      activeId = id;
      return;
    }
    const id = projectId();
    projects = [{ id, name: "My first project", updatedAt: Date.now(), data: blankData() }];
    activeId = id;
  }

  // ---- Project actions ----------------------------------------------------
  function switchProject(id) {
    if (id === activeId) return;
    save();                       // persist the project we're leaving
    activeId = id;
    applyStateData(activeProject().data);
    ensureRespondents();
    renderProjectSelect();
    renderWorkspace();
    save();
  }
  function newProject(name) {
    save();
    const id = projectId();
    projects.push({ id, name: name || "Project " + (projects.length + 1), updatedAt: Date.now(), data: blankData() });
    activeId = id;
    applyStateData(blankData());
    ensureRespondents();
    renderProjectSelect();
    renderWorkspace();
    save();
  }
  function renameProject() {
    const p = activeProject();
    if (!p) return;
    const name = prompt("Rename project:", p.name);
    if (name === null) return;
    p.name = name.trim() || p.name;
    renderProjectSelect();
    save();
  }
  function duplicateProject() {
    save();
    const p = activeProject();
    const id = projectId();
    const copy = JSON.parse(JSON.stringify(p.data));
    projects.push({ id, name: p.name + " (copy)", updatedAt: Date.now(), data: copy });
    activeId = id;
    applyStateData(copy);
    ensureRespondents();
    renderProjectSelect();
    renderWorkspace();
    save();
  }
  function deleteProject() {
    const p = activeProject();
    if (!p) return;
    if (!confirm(`Delete project “${p.name}”? This cannot be undone.`)) return;
    projects = projects.filter((x) => x.id !== activeId);
    if (projects.length === 0) {
      projects.push({ id: projectId(), name: "My first project", updatedAt: Date.now(), data: blankData() });
    }
    activeId = projects[0].id;
    applyStateData(activeProject().data);
    ensureRespondents();
    renderProjectSelect();
    renderWorkspace();
    save();
  }
  function renderProjectSelect() {
    const sel = $("projectSelect");
    if (!sel) return;
    sel.innerHTML = "";
    projects
      .slice()
      .forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.name;
        opt.title = (p.data && p.data.description) || "";
        if (p.id === activeId) opt.selected = true;
        sel.appendChild(opt);
      });
  }

  // Render the whole workspace from the current state (used on load / switch).
  function renderWorkspace() {
    $("goalInput").value = state.goal || "";
    $("projectDesc").value = state.description || "";
    $("setupValidation").textContent = "";
    renderTreeEditor();
    renderAlternatives();
    if (state.built && AHPTree.leaves(state.tree).length >= 1 && state.alternatives.length >= 2) {
      buildMatrices();
      renderCompareStep();
      renderResults();
    } else {
      $("compare").classList.add("hidden");
      $("results").classList.add("hidden");
    }
  }

  // ---- Respondents -------------------------------------------------------
  function makeRespondent(name) {
    return { id: newId(), name: name, criteriaMatrices: {}, altMatrices: {} };
  }
  function respondentById(id) {
    return state.respondents.find((r) => r.id === id) || null;
  }
  function ensureRespondents() {
    if (!Array.isArray(state.respondents) || state.respondents.length === 0) {
      state.respondents = [makeRespondent("Respondent 1")];
    }
    if (!state.respondents.some((r) => r.id === state.activeRespondent) && state.activeRespondent !== "group") {
      state.activeRespondent = state.respondents[0].id;
    }
  }
  function addRespondent() {
    const r = makeRespondent("Respondent " + (state.respondents.length + 1));
    state.respondents.push(r);
    state.activeRespondent = r.id;
    if (state.built) buildMatrices();   // size the new respondent's matrices
    renderRespondentBar();
    renderCompareTabs();
    renderResults();
    save();
  }
  function removeRespondent(id) {
    if (state.respondents.length <= 1) return;
    state.respondents = state.respondents.filter((r) => r.id !== id);
    if (state.activeRespondent === id) state.activeRespondent = state.respondents[0].id;
    renderRespondentBar();
    renderCompareTabs();
    renderResults();
    save();
  }

  // The matrix set currently being viewed: a respondent, or the aggregated group.
  function activeSource() {
    if (state.activeRespondent === "group") return aggregatedSource();
    return respondentById(state.activeRespondent) || state.respondents[0];
  }
  function isGroupView() { return state.activeRespondent === "group"; }

  // Geometric-mean aggregation of every respondent's matrices (read-only).
  function aggregatedSource() {
    const criteriaMatrices = {};
    const altMatrices = {};
    AHPTree.internals(state.tree)
      .filter((n) => n.children.length >= 2)
      .forEach((node) => {
        criteriaMatrices[node.id] = AHP.geomMeanMatrices(
          state.respondents.map((r) => r.criteriaMatrices[node.id])
        );
      });
    AHPTree.leaves(state.tree).forEach((leaf) => {
      altMatrices[leaf.id] = AHP.geomMeanMatrices(
        state.respondents.map((r) => r.altMatrices[leaf.id])
      );
    });
    return { criteriaMatrices, altMatrices };
  }

  // ---- Slider <-> intensity mapping --------------------------------------
  // Slider position p in [-8, 8]. p=0 -> equal (value 1). |p| maps to intensity |p|+1.
  // The thumb points at whichever side it leans toward: p<0 favours the LEFT
  // item, p>0 favours the RIGHT item. matrix[i][j] is the ratio of left over
  // right, so favouring the left means a value > 1.
  function sliderToValue(p) {
    const intensity = Math.abs(p) + 1; // 1..9
    return p <= 0 ? intensity : 1 / intensity;
  }
  function valueToSlider(v) {
    if (v >= 1) return -Math.round(v - 1);   // left favoured -> negative position
    return Math.round(1 / v - 1);            // right favoured -> positive position
  }
  // Continuous (non-rounded) position — used for read-only views (e.g. the group
  // geometric mean) so the thumb reflects the true aggregated ratio, not a snapped notch.
  function valueToSliderExact(v) {
    const p = v >= 1 ? -(v - 1) : (1 / v - 1);
    return Math.max(-8, Math.min(8, p));
  }
  // The gauge value (left:right ratio) as a Saaty fraction: "3" if the left item
  // is favoured, "1/3" if the right (second) item is, "1" when equal.
  function formatSaatyRatio(v) {
    if (Math.abs(v - 1) < 1e-9) return "1";
    return v > 1 ? String(Math.round(v)) : "1/" + Math.round(1 / v);
  }

  // ---- Criteria tree editor ----------------------------------------------
  function renderTreeEditor() {
    const host = $("criteriaTree");
    host.innerHTML = "";
    if (state.tree.children.length === 0) {
      const p = document.createElement("p");
      p.className = "hint";
      p.style.margin = "0";
      p.textContent = "No criteria yet — add your first one below.";
      host.appendChild(p);
      return;
    }
    state.tree.children.forEach((child) => host.appendChild(renderTreeNode(child, 0)));
  }

  function renderTreeNode(node, depth) {
    const wrap = document.createElement("div");
    wrap.className = "tree-node";

    const row = document.createElement("div");
    row.className = "tree-row depth-" + depth;

    const name = document.createElement("input");
    name.type = "text";
    name.className = "tree-name";
    name.value = node.name;
    name.placeholder = "Criterion name";
    name.addEventListener("input", () => {
      node.name = name.value;
      invalidateBuild(false); // keep focus: don't re-render the tree
    });

    const addSub = document.createElement("button");
    addSub.type = "button";
    addSub.className = "tree-btn";
    addSub.textContent = "+ sub";
    addSub.title = "Add a sub-criterion under " + (node.name || "this criterion");
    addSub.addEventListener("click", () => {
      node.children = node.children || [];
      node.children.push({ id: newId(), name: "", children: [] });
      invalidateBuild(true);
      focusLastInput(wrap);
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "tree-btn remove";
    del.textContent = "✕";
    del.title = "Remove this criterion (and its sub-criteria)";
    del.addEventListener("click", () => {
      AHPTree.removeById(state.tree, node.id);
      invalidateBuild(true);
    });

    row.appendChild(name);
    row.appendChild(addSub);
    row.appendChild(del);
    wrap.appendChild(row);

    if (node.children && node.children.length) {
      const kids = document.createElement("div");
      kids.className = "tree-children";
      node.children.forEach((c) => kids.appendChild(renderTreeNode(c, depth + 1)));
      wrap.appendChild(kids);
    }
    return wrap;
  }

  function focusLastInput(container) {
    const inputs = container.querySelectorAll("input.tree-name");
    if (inputs.length) inputs[inputs.length - 1].focus();
  }

  // ---- Alternatives list -------------------------------------------------
  function renderAlternatives() {
    const listEl = $("alternativesList");
    listEl.innerHTML = "";
    state.alternatives.forEach((item, idx) => {
      const li = document.createElement("li");
      li.className = "chip";
      const span = document.createElement("span");
      span.textContent = item;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("aria-label", "Remove " + item);
      btn.textContent = "✕";
      btn.addEventListener("click", () => {
        state.alternatives.splice(idx, 1);
        invalidateBuild(true);
      });
      li.appendChild(span);
      li.appendChild(btn);
      listEl.appendChild(li);
    });
  }

  function addCriterion(inputEl) {
    const val = inputEl.value.trim();
    if (!val) return;
    state.tree.children.push({ id: newId(), name: val, children: [] });
    inputEl.value = "";
    invalidateBuild(true);
  }

  function addAlternative(inputEl) {
    const val = inputEl.value.trim();
    if (!val) return;
    if (state.alternatives.some((x) => x.toLowerCase() === val.toLowerCase())) {
      inputEl.value = "";
      return;
    }
    state.alternatives.push(val);
    inputEl.value = "";
    invalidateBuild(true);
  }

  // When the hierarchy / alternatives change, comparisons must be rebuilt.
  function invalidateBuild(rerenderEditors) {
    state.built = false;
    $("compare").classList.add("hidden");
    $("results").classList.add("hidden");
    if (rerenderEditors) {
      renderTreeEditor();
      renderAlternatives();
    }
    save();
  }

  // ---- Build comparison structures ---------------------------------------
  // Ensure every respondent has a correctly-sized matrix for each comparison,
  // preserving any existing judgements whose dimensions still match.
  function buildMatrices() {
    ensureRespondents();
    const internals = AHPTree.internals(state.tree);
    const leaves = AHPTree.leaves(state.tree);
    const A = state.alternatives.length;

    state.respondents.forEach((r) => {
      const newCrit = {};
      internals.forEach((node) => {
        const k = node.children.length;
        const existing = r.criteriaMatrices[node.id];
        newCrit[node.id] = (Array.isArray(existing) && existing.length === k)
          ? existing : AHP.identityComparison(k);
      });
      r.criteriaMatrices = newCrit;

      const newAlt = {};
      leaves.forEach((leaf) => {
        const existing = r.altMatrices[leaf.id];
        newAlt[leaf.id] = (Array.isArray(existing) && existing.length === A)
          ? existing : AHP.identityComparison(A);
      });
      r.altMatrices = newAlt;
    });

    state.built = true;
  }

  // ---- Generic pairwise UI -----------------------------------------------
  function renderPairwise(host, labels, matrix, onChange, readOnly) {
    host.innerHTML = "";
    const n = labels.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        host.appendChild(buildPairRow(labels, matrix, i, j, onChange, readOnly));
      }
    }
  }

  function buildPairRow(labels, matrix, i, j, onChange, readOnly) {
    const row = document.createElement("div");
    row.className = "pair-row";

    const left = document.createElement("div");
    left.className = "pair-label left";
    left.textContent = labels[i];

    const right = document.createElement("div");
    right.className = "pair-label right";
    right.textContent = labels[j];

    const wrap = document.createElement("div");
    wrap.className = "slider-wrap";

    const controls = document.createElement("div");
    controls.className = "slider-controls";

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "-8";
    slider.max = "8";
    // Read-only views (group geometric mean) can sit between Saaty notches, so
    // allow a continuous thumb position; editable views snap to integer steps.
    slider.step = readOnly ? "any" : "1";
    slider.value = String(readOnly ? valueToSliderExact(matrix[i][j]) : valueToSlider(matrix[i][j]));

    const readout = document.createElement("div");
    readout.className = "slider-readout";

    function refresh() {
      if (readOnly) {
        // Group average: show the raw geometric-mean ratio (< 1 when the right item wins).
        const v = matrix[i][j];
        const eq = Math.abs(v - 1) < 5e-3;
        left.classList.toggle("active", v > 1 && !eq);
        right.classList.toggle("active", v < 1 && !eq);
        readout.textContent = eq
          ? "≈ Equal · value 1.00"
          : `${v > 1 ? labels[i] : labels[j]} — value ${v.toFixed(2)} (geo. mean)`;
        return;
      }
      const p = parseInt(slider.value, 10);
      const intensity = Math.abs(p) + 1;
      left.classList.toggle("active", p < 0);
      right.classList.toggle("active", p > 0);
      // value = left:right ratio ("3" if left wins, "1/3" if the right item wins).
      readout.textContent = p === 0
        ? "Equal importance · value 1"
        : `${p < 0 ? labels[i] : labels[j]} — ${VERBAL[intensity]} · value ${formatSaatyRatio(sliderToValue(p))}`;
    }

    // Move the comparison one notch. delta<0 favours the left item, delta>0 the right.
    function step(delta) {
      const p = Math.max(-8, Math.min(8, parseInt(slider.value, 10) + delta));
      slider.value = String(p);
      AHP.setPair(matrix, i, j, sliderToValue(p));
      refresh();
      onChange();
    }

    if (readOnly) {
      slider.disabled = true;
      controls.appendChild(slider);
    } else {
      slider.addEventListener("input", () => {
        AHP.setPair(matrix, i, j, sliderToValue(parseInt(slider.value, 10)));
        refresh();
        onChange();
      });

      const lessBtn = document.createElement("button");
      lessBtn.type = "button";
      lessBtn.className = "step-btn";
      lessBtn.textContent = "◀";
      lessBtn.title = "More important: " + labels[i];
      lessBtn.setAttribute("aria-label", "Favour " + labels[i]);
      lessBtn.addEventListener("click", () => step(-1));

      const moreBtn = document.createElement("button");
      moreBtn.type = "button";
      moreBtn.className = "step-btn";
      moreBtn.textContent = "▶";
      moreBtn.title = "More important: " + labels[j];
      moreBtn.setAttribute("aria-label", "Favour " + labels[j]);
      moreBtn.addEventListener("click", () => step(1));

      controls.appendChild(lessBtn);
      controls.appendChild(slider);
      controls.appendChild(moreBtn);
    }

    refresh();
    wrap.appendChild(controls);
    wrap.appendChild(readout);
    row.appendChild(left);
    row.appendChild(wrap);
    row.appendChild(right);
    return row;
  }

  // ---- Consistency banner -------------------------------------------------
  function renderConsistency(el, labels, result) {
    const crPct = (result.cr * 100).toFixed(3);
    const ok = result.consistent;
    const pill = `<span class="pill ${ok ? "ok" : "bad"}">${ok ? "Consistent" : "Inconsistent"}</span>`;
    const tags = labels.map((lab, k) =>
      `<span class="weight-tag">${escapeHtml(lab)} <b>${(result.weights[k] * 100).toFixed(3)}%</b></span>`
    ).join("");
    el.innerHTML = `
      ${pill}
      &nbsp; Consistency Ratio <b>${crPct}%</b>
      &nbsp;·&nbsp; λ<sub>max</sub> ${result.lambdaMax.toFixed(4)}
      &nbsp;·&nbsp; CI ${result.ci.toFixed(4)}
      ${ok ? "" : `<div class="hint" style="margin-top:8px">CR above 10% — revisit the most contradictory judgements for a more reliable result.</div>`}
      <div class="weights-inline">${tags}</div>`;
  }

  // ---- Step 2: comparisons, presented as one tab strip -------------------
  // Each comparison (a criteria group or a leaf's alternative scoring) is a tab.
  function comparisonItems() {
    const items = [];
    // Criteria groups: every internal node with >= 2 children.
    AHPTree.internals(state.tree)
      .filter((n) => n.children.length >= 2)
      .forEach((node) => items.push({ kind: "crit", id: node.id, key: "crit:" + node.id, node }));
    // Alternative scoring: one per leaf (needs >= 2 alternatives).
    if (state.alternatives.length >= 2) {
      AHPTree.leaves(state.tree).forEach((leaf) =>
        items.push({ kind: "alt", id: leaf.id, key: "alt:" + leaf.id, node: leaf }));
    }
    return items;
  }

  function itemLabels(item) {
    return item.kind === "crit"
      ? item.node.children.map((c) => c.name || "(unnamed)")
      : state.alternatives;
  }
  function itemMatrix(item, source) {
    return item.kind === "crit"
      ? source.criteriaMatrices[item.id]
      : source.altMatrices[item.id];
  }
  function itemTabLabel(item) {
    if (item.kind === "crit") {
      return item.id === "root" ? "Criteria" : AHPTree.pathLabel(state.tree, item.id);
    }
    return AHPTree.pathLabel(state.tree, item.id);
  }

  // Full render of Step 2: respondent bar + comparison tabs/panel.
  function renderCompareStep() {
    $("compare").classList.remove("hidden");
    renderRespondentBar();
    renderCompareTabs();
  }

  // The respondent selector: one chip per respondent + add + group view.
  function renderRespondentBar() {
    ensureRespondents();
    const bar = $("respondentBar");
    bar.innerHTML = "";

    const label = document.createElement("span");
    label.className = "tab-label";
    label.textContent = "Respondents";
    bar.appendChild(label);

    state.respondents.forEach((r) => {
      const chip = document.createElement("div");
      chip.className = "resp-chip" + (state.activeRespondent === r.id ? " active" : "");
      chip.dataset.respId = r.id;

      const input = document.createElement("input");
      input.type = "text";
      input.className = "resp-name";
      input.value = r.name;
      input.setAttribute("aria-label", "Respondent name");
      // Focusing a chip selects that respondent (without rebuilding the bar,
      // so the input keeps focus and can be renamed immediately).
      input.addEventListener("focus", () => {
        if (state.activeRespondent !== r.id) {
          state.activeRespondent = r.id;
          markActiveRespondent();
          renderCompareTabs();
          renderResults();
          save();
        }
      });
      input.addEventListener("input", () => {
        r.name = input.value;
        save();
        if (state.built) renderResults();
      });
      chip.appendChild(input);

      if (state.respondents.length > 1) {
        const x = document.createElement("button");
        x.type = "button";
        x.className = "resp-x";
        x.textContent = "✕";
        x.title = "Remove this respondent";
        x.addEventListener("click", () => removeRespondent(r.id));
        chip.appendChild(x);
      }
      bar.appendChild(chip);
    });

    const add = document.createElement("button");
    add.type = "button";
    add.className = "btn small";
    add.textContent = "＋ Respondent";
    add.addEventListener("click", addRespondent);
    bar.appendChild(add);

    const group = document.createElement("button");
    group.type = "button";
    group.className = "group-tab" + (isGroupView() ? " active" : "");
    group.textContent = "Group (avg)";
    group.title = "Aggregated across all respondents (geometric mean)";
    group.dataset.groupTab = "1";
    group.addEventListener("click", () => {
      state.activeRespondent = "group";
      markActiveRespondent();
      renderCompareTabs();
      renderResults();
      save();
    });
    bar.appendChild(group);
  }

  // Toggle active styling on the bar without a full rebuild (keeps input focus).
  function markActiveRespondent() {
    const bar = $("respondentBar");
    [...bar.querySelectorAll(".resp-chip")].forEach((chip) => {
      chip.classList.toggle("active", chip.dataset.respId === state.activeRespondent);
    });
    const group = bar.querySelector("[data-group-tab]");
    if (group) group.classList.toggle("active", isGroupView());
  }

  // The comparison tab strip + active panel, for the current source.
  function renderCompareTabs() {
    const tabsEl = $("compareTabs");
    const panel = $("comparePanel");
    tabsEl.innerHTML = "";
    panel.innerHTML = "";

    const items = comparisonItems();
    if (items.length === 0) {
      panel.innerHTML = `<span class="hint">Add at least two criteria and two alternatives to start comparing.</span>`;
      return;
    }
    if (!items.some((it) => it.key === state.activeCompareKey)) {
      state.activeCompareKey = items[0].key;
    }

    const source = activeSource();
    let lastKind = null;
    items.forEach((item) => {
      if (item.kind !== lastKind) {
        const lab = document.createElement("span");
        lab.className = "tab-label";
        lab.textContent = item.kind === "crit" ? "Weigh criteria" : "Score alternatives by";
        tabsEl.appendChild(lab);
        lastKind = item.kind;
      }
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "tab" + (item.key === state.activeCompareKey ? " active" : "");
      const dot = document.createElement("span");
      dot.className = "dot " + (AHP.analyze(itemMatrix(item, source)).consistent ? "ok" : "bad");
      tab.appendChild(dot);
      tab.appendChild(document.createTextNode(itemTabLabel(item)));
      tab.addEventListener("click", () => {
        state.activeCompareKey = item.key;
        renderCompareTabs();
      });
      tabsEl.appendChild(tab);
    });

    const active = items.find((it) => it.key === state.activeCompareKey);
    renderComparePanel(active, panel, tabsEl, source);
  }

  function renderComparePanel(item, panel, tabsEl, source) {
    const labels = itemLabels(item);
    const matrix = itemMatrix(item, source);
    const readOnly = isGroupView();

    const heading = document.createElement("p");
    heading.className = "hint";
    if (item.kind === "crit") {
      heading.innerHTML = item.id === "root"
        ? `Weigh the <b>top-level criteria</b> against each other.`
        : `Weigh the sub-criteria of <b>${escapeHtml(AHPTree.pathLabel(state.tree, item.id))}</b>.`;
    } else {
      heading.innerHTML = `Score the alternatives by <b>${escapeHtml(AHPTree.pathLabel(state.tree, item.id))}</b>: which performs better, and how strongly?`;
    }
    panel.appendChild(heading);

    if (readOnly) {
      const note = document.createElement("p");
      note.className = "readonly-note";
      note.textContent = `Aggregated from ${state.respondents.length} respondent${state.respondents.length === 1 ? "" : "s"} (geometric mean) — read-only. Select a respondent to edit.`;
      panel.appendChild(note);
    }

    const matrixHost = document.createElement("div");
    panel.appendChild(matrixHost);
    const banner = document.createElement("div");
    banner.className = "consistency";
    panel.appendChild(banner);

    renderPairwise(matrixHost, labels, matrix, () => {
      const r = AHP.analyze(matrix);
      renderConsistency(banner, labels, r);
      const activeTab = [...tabsEl.children].find((t) => t.classList.contains("active"));
      const dot = activeTab && activeTab.querySelector(".dot");
      if (dot) dot.className = "dot " + (r.consistent ? "ok" : "bad");
      save();
      renderResults();
    }, readOnly);
    renderConsistency(banner, labels, AHP.analyze(matrix));
  }

  // ---- Step 4: results ----------------------------------------------------
  function renderResults() {
    if (!state.built) return;
    const leaves = AHPTree.leaves(state.tree);
    if (leaves.length === 0 || state.alternatives.length < 2) {
      $("results").classList.add("hidden");
      return;
    }
    $("results").classList.remove("hidden");

    const source = activeSource();
    const weights = AHPTree.computeWeights(state.tree, source.criteriaMatrices);
    const leafWeights = leaves.map((l) => weights[l.id].global);
    const altWeightsPerLeaf = leaves.map((l) => AHP.analyze(source.altMatrices[l.id]).weights);
    const scores = AHP.aggregate(leafWeights, altWeightsPerLeaf);
    const maxScore = Math.max(...scores, 1e-9);

    const ranked = state.alternatives
      .map((name, i) => ({ name, score: scores[i], i }))
      .sort((a, b) => b.score - a.score);

    const body = $("resultsBody");
    body.innerHTML = "";

    // Whose result is this?
    const srcLine = document.createElement("p");
    srcLine.className = "results-note";
    if (isGroupView()) {
      srcLine.innerHTML = `Showing the <b>group result</b> — aggregated from ${state.respondents.length} respondent${state.respondents.length === 1 ? "" : "s"} (geometric mean).`;
    } else {
      const r = respondentById(state.activeRespondent) || state.respondents[0];
      const suffix = state.respondents.length > 1 ? ` &nbsp;<span style="color:var(--muted)">(switch to “Group (avg)” for the combined result)</span>` : "";
      srcLine.innerHTML = `Showing results for <b>${escapeHtml(r.name)}</b>.${suffix}`;
    }
    body.appendChild(srcLine);

    // Goal + ranking
    const goalLine = document.createElement("p");
    goalLine.className = "results-note";
    goalLine.innerHTML = state.goal ? `Goal: <b>${escapeHtml(state.goal)}</b>` : "Final ranking of alternatives:";
    body.appendChild(goalLine);

    const list = document.createElement("div");
    list.className = "rank-list";
    ranked.forEach((row, pos) => {
      const item = document.createElement("div");
      item.className = "rank-item" + (pos === 0 ? " winner" : "");
      item.innerHTML = `
        <div class="rank-badge">${pos + 1}</div>
        <div>
          <div class="rank-name">${escapeHtml(row.name)}</div>
          <div class="rank-bar-track">
            <div class="rank-bar-fill" style="width:${(row.score / maxScore * 100).toFixed(1)}%"></div>
          </div>
        </div>
        <div class="rank-score">${(row.score * 100).toFixed(3)}%<small>priority</small></div>`;
      list.appendChild(item);
    });
    body.appendChild(list);

    // Leaf weights (hierarchy) table
    const lwNote = document.createElement("p");
    lwNote.className = "results-note";
    lwNote.textContent = "Criteria leaf weights (local within parent → global toward the goal):";
    body.appendChild(lwNote);
    body.appendChild(buildLeafWeightTable(leaves, weights));

    // Synthesis decision matrix: alternatives × leaves
    const synNote = document.createElement("p");
    synNote.className = "results-note";
    synNote.textContent = "Decision matrix — each cell is the alternative's local priority for that leaf criterion:";
    body.appendChild(synNote);
    body.appendChild(buildSynthesisTable(leaves, leafWeights, altWeightsPerLeaf, scores));
  }

  function buildLeafWeightTable(leaves, weights) {
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    const t = document.createElement("table");
    t.className = "matrix-table";
    let head = "<tr><th>Leaf criterion</th><th>Local</th><th>Global</th></tr>";
    const rows = leaves.map((l) => {
      const w = weights[l.id];
      return `<tr>
        <td class="lead">${escapeHtml(AHPTree.pathLabel(state.tree, l.id))}</td>
        <td>${(w.local * 100).toFixed(3)}%</td>
        <td><b>${(w.global * 100).toFixed(3)}%</b></td></tr>`;
    }).join("");
    t.innerHTML = head + rows;
    wrap.appendChild(t);
    return wrap;
  }

  function buildSynthesisTable(leaves, leafWeights, altWeightsPerLeaf, scores) {
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    const t = document.createElement("table");
    t.className = "matrix-table";

    let head = "<tr><th>Alternative</th>";
    leaves.forEach((l, i) => {
      head += `<th>${escapeHtml(l.name || "(unnamed)")}<br><small>${(leafWeights[i] * 100).toFixed(1)}%</small></th>`;
    });
    head += "<th>Score</th></tr>";

    let rows = "";
    state.alternatives.forEach((name, a) => {
      let r = `<tr><td class="lead">${escapeHtml(name)}</td>`;
      leaves.forEach((l, c) => {
        const v = altWeightsPerLeaf[c][a] || 0;
        const shade = 0.08 + 0.32 * v;
        r += `<td class="heat" style="background:rgba(79,156,255,${shade.toFixed(3)})">${(v * 100).toFixed(3)}%</td>`;
      });
      r += `<td><b>${(scores[a] * 100).toFixed(3)}%</b></td></tr>`;
      rows += r;
    });

    t.innerHTML = head + rows;
    wrap.appendChild(t);
    return wrap;
  }

  // ---- CSV export ---------------------------------------------------------
  function csvCell(v) {
    if (v === undefined || v === null) return "";
    const s = String(v);
    const needsQuote = s.indexOf('"') !== -1 || s.indexOf(",") !== -1 ||
      s.indexOf("\n") !== -1 || s.indexOf("\r") !== -1;
    return needsQuote ? '"' + s.split('"').join('""') + '"' : s;
  }
  function csvNum(x) {
    return (typeof x === "number" && isFinite(x)) ? x.toFixed(6) : "";
  }
  function csvPct(x) {
    return (typeof x === "number" && isFinite(x)) ? (x * 100).toFixed(3) + "%" : "";
  }

  // Final scores for one respondent/source's matrices.
  function scoresFor(source, leaves) {
    const weights = AHPTree.computeWeights(state.tree, source.criteriaMatrices);
    const leafWeights = leaves.map((l) => weights[l.id].global);
    const altWeightsPerLeaf = leaves.map((l) => AHP.analyze(source.altMatrices[l.id]).weights);
    return { weights, leafWeights, altWeightsPerLeaf, scores: AHP.aggregate(leafWeights, altWeightsPerLeaf) };
  }

  // Build a multi-section CSV of the full analysis (active view + cross-respondent).
  function buildResultsCsv() {
    const leaves = AHPTree.leaves(state.tree);
    const source = activeSource();
    const { weights, leafWeights, altWeightsPerLeaf, scores } = scoresFor(source, leaves);

    const ranked = state.alternatives
      .map((name, i) => ({ name, score: scores[i] }))
      .sort((a, b) => b.score - a.score);

    const sourceLabel = isGroupView()
      ? `Group (aggregated from ${state.respondents.length} respondents)`
      : (respondentById(state.activeRespondent) || state.respondents[0]).name;

    const rows = [];
    const push = (...cells) => rows.push(cells.map(csvCell).join(","));

    push("AHP Decision Analysis");
    push("Goal", state.goal || "(none)");
    if (state.description) push("Description", state.description);
    push("Result shown for", sourceLabel);
    push("Priority method", "Principal eigenvector (power iteration)");
    push();

    push("Final ranking");
    push("Rank", "Alternative", "Priority", "Priority %");
    ranked.forEach((r, pos) => push(pos + 1, r.name, csvNum(r.score), csvPct(r.score)));
    push();

    push("Criteria leaf weights");
    push("Criterion (path)", "Local weight", "Global weight");
    leaves.forEach((l) =>
      push(AHPTree.pathLabel(state.tree, l.id), csvNum(weights[l.id].local), csvNum(weights[l.id].global)));
    push();

    push("Decision matrix (local priority of each alternative per leaf criterion)");
    push("Alternative", ...leaves.map((l) => AHPTree.pathLabel(state.tree, l.id)), "Final score");
    state.alternatives.forEach((name, a) =>
      push(name, ...leaves.map((l, c) => csvNum(altWeightsPerLeaf[c][a])), csvNum(scores[a])));
    push();

    push("Consistency check (per comparison)");
    push("Comparison", "Size", "Consistency Ratio", "CR %", "lambda_max", "Consistent?");
    comparisonItems().forEach((item) => {
      const res = AHP.analyze(itemMatrix(item, source));
      const label = item.kind === "crit"
        ? (item.id === "root" ? "Criteria" : AHPTree.pathLabel(state.tree, item.id) + " (sub-criteria)")
        : "Alternatives by " + AHPTree.pathLabel(state.tree, item.id);
      push(label, itemLabels(item).length, csvNum(res.cr), csvPct(res.cr), res.lambdaMax.toFixed(6), res.consistent ? "Yes" : "No");
    });
    push();

    // Cross-respondent comparison of final scores (only meaningful with >1 respondent).
    if (state.respondents.length > 1) {
      push("Final scores by respondent");
      push("Alternative", ...state.respondents.map((r) => r.name), "Group (avg)");
      const perRes = state.respondents.map((r) => scoresFor(r, leaves).scores);
      const groupScores = scoresFor(aggregatedSource(), leaves).scores;
      state.alternatives.forEach((name, a) =>
        push(name, ...perRes.map((s) => csvNum(s[a])), csvNum(groupScores[a])));
      push();
    }

    return "﻿" + rows.join("\r\n"); // BOM so Excel reads UTF-8 correctly
  }

  function slugify(s) {
    return (s || "ahp-results").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "ahp-results";
  }

  function downloadFile(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function downloadResultsCsv() {
    if (!state.built || AHPTree.leaves(state.tree).length < 1 || state.alternatives.length < 2) return;
    const date = new Date().toISOString().slice(0, 10);
    downloadFile(`AHP-${slugify(state.goal)}-${date}.csv`, buildResultsCsv(), "text/csv;charset=utf-8");
  }

  // ---- XLSX export (multi-tab workbook, no dependencies) -----------------
  // An .xlsx is a ZIP of XML parts. We build the parts and a minimal ZIP
  // (stored / uncompressed entries with CRC-32) entirely in the browser.

  function escapeXml(s) {
    return String(s).split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;");
  }
  // A bare number string (no scientific notation) that Excel reads exactly.
  function numStr(x) {
    if (typeof x !== "number" || !isFinite(x)) return "0";
    let s = x.toFixed(12);
    if (s.indexOf(".") !== -1) s = s.replace(/0+$/, "").replace(/\.$/, "");
    return (s === "" || s === "-0") ? "0" : s;
  }
  function colLetter(i) { // 0-based column index -> A, B, ... AA
    let s = "";
    i += 1;
    while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }

  // Cell factories: H = bold header text, T = text, N = number.
  function H(v) { return { kind: "h", v: v }; }
  function T(v) { return { kind: "t", v: v }; }
  function N(v) { return { kind: "n", v: v }; }

  function cellXml(cell, ref) {
    if (!cell) return "";
    if (cell.kind === "n") {
      if (typeof cell.v !== "number" || !isFinite(cell.v)) return "";
      return `<c r="${ref}"><v>${numStr(cell.v)}</v></c>`;
    }
    const style = cell.kind === "h" ? ` s="1"` : "";
    return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.v)}</t></is></c>`;
  }
  function sheetXml(rows) {
    let body = "";
    rows.forEach((row, ri) => {
      const r = ri + 1;
      let cells = "";
      row.forEach((cell, ci) => { cells += cellXml(cell, colLetter(ci) + r); });
      body += `<row r="${r}">${cells}</row>`;
    });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
  }

  // Assemble the result tabs.
  function buildWorkbookSheets() {
    const leaves = AHPTree.leaves(state.tree);
    const source = activeSource();
    const { weights, leafWeights, altWeightsPerLeaf, scores } = scoresFor(source, leaves);
    const ranked = state.alternatives
      .map((name, i) => ({ name, score: scores[i] }))
      .sort((a, b) => b.score - a.score);
    const sourceLabel = isGroupView()
      ? `Group (avg of ${state.respondents.length} respondents)`
      : (respondentById(state.activeRespondent) || state.respondents[0]).name;
    const path = (l) => AHPTree.pathLabel(state.tree, l.id);
    const sheets = [];

    const summary = [
      [H("AHP Decision Analysis")],
      [T("Goal"), T(state.goal || "(none)")],
    ];
    if (state.description) summary.push([T("Description"), T(state.description)]);
    summary.push([T("Result shown for"), T(sourceLabel)]);
    summary.push([T("Priority method"), T("Principal eigenvector (power iteration)")]);
    summary.push([]);
    summary.push([H("Rank"), H("Alternative"), H("Priority"), H("Priority %")]);
    ranked.forEach((r, pos) => summary.push([N(pos + 1), T(r.name), N(r.score), N(r.score * 100)]));
    sheets.push({ name: "Summary", rows: summary });

    const cw = [[H("Criterion (path)"), H("Local weight"), H("Global weight"), H("Global %")]];
    leaves.forEach((l) => cw.push([T(path(l)), N(weights[l.id].local), N(weights[l.id].global), N(weights[l.id].global * 100)]));
    sheets.push({ name: "Criteria Weights", rows: cw });

    const dm = [[H("Alternative"), ...leaves.map((l) => H(path(l))), H("Final score")]];
    state.alternatives.forEach((name, a) => dm.push([T(name), ...leaves.map((l, c) => N(altWeightsPerLeaf[c][a])), N(scores[a])]));
    dm.push([]);
    dm.push([T("Leaf global weight"), ...leaves.map((l, c) => N(leafWeights[c]))]);
    sheets.push({ name: "Decision Matrix", rows: dm });

    const cons = [[H("Comparison"), H("Size"), H("Consistency Ratio"), H("CR %"), H("lambda_max"), H("Consistent?")]];
    comparisonItems().forEach((item) => {
      const res = AHP.analyze(itemMatrix(item, source));
      const label = item.kind === "crit"
        ? (item.id === "root" ? "Criteria" : path(item.node) + " (sub-criteria)")
        : "Alternatives by " + path(item.node);
      cons.push([T(label), N(itemLabels(item).length), N(res.cr), N(res.cr * 100), N(res.lambdaMax), T(res.consistent ? "Yes" : "No")]);
    });
    sheets.push({ name: "Consistency", rows: cons });

    if (state.respondents.length > 1) {
      const br = [[H("Alternative"), ...state.respondents.map((r) => H(r.name)), H("Group (avg)")]];
      const perRes = state.respondents.map((r) => scoresFor(r, leaves).scores);
      const groupScores = scoresFor(aggregatedSource(), leaves).scores;
      state.alternatives.forEach((name, a) => br.push([T(name), ...perRes.map((s) => N(s[a])), N(groupScores[a])]));
      sheets.push({ name: "By Respondent", rows: br });
    }
    return sheets;
  }

  const STYLES_XML =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`;

  function buildXlsx() {
    const sheets = buildWorkbookSheets();
    const enc = new TextEncoder();
    const parts = [];

    const ct =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
      `</Types>`;
    parts.push({ name: "[Content_Types].xml", bytes: enc.encode(ct) });

    parts.push({ name: "_rels/.rels", bytes: enc.encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`) });

    const sheetTags = sheets.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
    parts.push({ name: "xl/workbook.xml", bytes: enc.encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets>${sheetTags}</sheets></workbook>`) });

    const relTags = sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("");
    parts.push({ name: "xl/_rels/workbook.xml.rels", bytes: enc.encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      relTags +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`) });

    parts.push({ name: "xl/styles.xml", bytes: enc.encode(STYLES_XML) });
    sheets.forEach((s, i) => parts.push({ name: `xl/worksheets/sheet${i + 1}.xml`, bytes: enc.encode(sheetXml(s.rows)) }));

    return makeZip(parts);
  }

  // Minimal ZIP (store method) with CRC-32 — enough for Excel to open.
  function crc32(bytes) {
    let crc = ~0;
    for (let i = 0; i < bytes.length; i++) {
      crc ^= bytes[i];
      for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
    return (~crc) >>> 0;
  }
  function makeZip(entries) {
    const u16 = (a, n) => a.push(n & 0xff, (n >>> 8) & 0xff);
    const u32 = (a, n) => a.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
    const enc = new TextEncoder();
    const fileParts = [];
    const centralParts = [];
    let offset = 0;
    const DOS_TIME = 0;
    const DOS_DATE = 0x21; // 1980-01-01

    entries.forEach((e) => {
      const nameBytes = enc.encode(e.name);
      const data = e.bytes;
      const crc = crc32(data);
      const lh = [];
      u32(lh, 0x04034b50); u16(lh, 20); u16(lh, 0); u16(lh, 0);
      u16(lh, DOS_TIME); u16(lh, DOS_DATE);
      u32(lh, crc); u32(lh, data.length); u32(lh, data.length);
      u16(lh, nameBytes.length); u16(lh, 0);
      const lhBytes = Uint8Array.from(lh);
      fileParts.push(lhBytes, nameBytes, data);

      const cd = [];
      u32(cd, 0x02014b50); u16(cd, 20); u16(cd, 20); u16(cd, 0); u16(cd, 0);
      u16(cd, DOS_TIME); u16(cd, DOS_DATE);
      u32(cd, crc); u32(cd, data.length); u32(cd, data.length);
      u16(cd, nameBytes.length); u16(cd, 0); u16(cd, 0);
      u16(cd, 0); u16(cd, 0); u32(cd, 0);
      u32(cd, offset);
      centralParts.push(Uint8Array.from(cd), nameBytes);

      offset += lhBytes.length + nameBytes.length + data.length;
    });

    let cdSize = 0;
    centralParts.forEach((p) => { cdSize += p.length; });
    const eocd = [];
    u32(eocd, 0x06054b50); u16(eocd, 0); u16(eocd, 0);
    u16(eocd, entries.length); u16(eocd, entries.length);
    u32(eocd, cdSize); u32(eocd, offset); u16(eocd, 0);

    const all = fileParts.concat(centralParts, [Uint8Array.from(eocd)]);
    let total = 0;
    all.forEach((p) => { total += p.length; });
    const out = new Uint8Array(total);
    let pos = 0;
    all.forEach((p) => { out.set(p, pos); pos += p.length; });
    return out;
  }

  function downloadResultsXlsx() {
    if (!state.built || AHPTree.leaves(state.tree).length < 1 || state.alternatives.length < 2) return;
    const date = new Date().toISOString().slice(0, 10);
    downloadFile(`AHP-${slugify(state.goal)}-${date}.xlsx`, buildXlsx(),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  }

  // ---- Build action -------------------------------------------------------
  function handleBuild() {
    const v = $("setupValidation");
    const leaves = AHPTree.leaves(state.tree);
    const topLevel = state.tree.children.length;
    if (topLevel < 2) { v.textContent = "Add at least two top-level criteria."; return; }
    if (leaves.length < 1) { v.textContent = "The hierarchy needs at least one leaf criterion."; return; }
    if (state.alternatives.length < 2) { v.textContent = "Add at least two alternatives."; return; }
    if (state.tree.children.some((c) => !c.name.trim())) { v.textContent = "Every criterion needs a name."; return; }
    v.textContent = "";

    buildMatrices();
    state.activeCompareKey = null;
    renderCompareStep();
    renderResults();
    save();
    $("compare").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---- Utilities ----------------------------------------------------------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ---- Sample data --------------------------------------------------------
  function sampleData() {
    state.goal = "Choose the best laptop for daily work";
    state.description = "Worked example: three laptops compared on cost (upfront + running), " +
      "performance (CPU/GPU + memory), battery life and build quality, judged by two respondents " +
      "— Priya (performance-focused) and Sam (budget-focused). Try the Group (avg) view.";
    state.nextId = 1;
    const id = () => newId();
    const cost = { id: id(), name: "Cost", children: [] };
    const costUpfront = { id: id(), name: "Upfront price", children: [] };
    const costRunning = { id: id(), name: "Running cost", children: [] };
    cost.children = [costUpfront, costRunning];

    const perf = { id: id(), name: "Performance", children: [] };
    const perfCpu = { id: id(), name: "CPU/GPU", children: [] };
    const perfRam = { id: id(), name: "Memory", children: [] };
    perf.children = [perfCpu, perfRam];

    const battery = { id: id(), name: "Battery life", children: [] };
    const build = { id: id(), name: "Build quality", children: [] };

    state.tree = { id: "root", name: "Goal", children: [cost, perf, battery, build] };
    state.alternatives = ["UltraBook X", "PowerPro 15", "BudgetMate"];

    // Two respondents with different priorities, to show group aggregation.
    const priya = makeRespondent("Priya");
    const sam = makeRespondent("Sam");
    state.respondents = [priya, sam];
    state.activeRespondent = priya.id;
    buildMatrices();

    const leaves = AHPTree.leaves(state.tree);
    // Both respondents perceive the same hardware facts, so alternative scoring is shared.
    // Alternatives order: [UltraBook X, PowerPro 15, BudgetMate].
    const altSpec = {
      "Upfront price": [[0, 1, 3], [0, 2, 1 / 2], [1, 2, 1 / 5]],
      "Running cost": [[0, 1, 2], [0, 2, 1 / 2], [1, 2, 1 / 3]],
      "CPU/GPU": [[0, 1, 1 / 4], [0, 2, 3], [1, 2, 6]],
      "Memory": [[0, 1, 1 / 3], [0, 2, 2], [1, 2, 4]],
      "Battery life": [[0, 1, 4], [0, 2, 2], [1, 2, 1 / 2]],
      "Build quality": [[0, 1, 1], [0, 2, 4], [1, 2, 4]],
    };
    // criteria order: [Cost, Performance, Battery, Build]
    const fill = (r, rootPairs, subCost, subPerf) => {
      rootPairs.forEach(([i, j, v]) => AHP.setPair(r.criteriaMatrices["root"], i, j, v));
      AHP.setPair(r.criteriaMatrices[cost.id], 0, 1, subCost); // Upfront vs Running
      AHP.setPair(r.criteriaMatrices[perf.id], 0, 1, subPerf); // CPU/GPU vs Memory
      Object.keys(altSpec).forEach((leafName) => {
        const leaf = leaves.find((l) => l.name === leafName);
        if (leaf) altSpec[leafName].forEach(([i, j, v]) => AHP.setPair(r.altMatrices[leaf.id], i, j, v));
      });
    };

    // Priya — performance-focused.
    fill(priya, [[0, 1, 1 / 2], [0, 2, 2], [0, 3, 3], [1, 2, 3], [1, 3, 4], [2, 3, 2]], 3, 2);
    // Sam — budget-focused (Cost dominates).
    fill(sam, [[0, 1, 3], [0, 2, 3], [0, 3, 4], [1, 2, 1], [1, 3, 2], [2, 3, 2]], 4, 1);

    state.activeCompareKey = null;
    state.activeRespondent = priya.id;
    state.built = true;
  }

  // ---- Example decisions (sidebar) ---------------------------------------
  // Each example scaffolds a goal, a criteria hierarchy and alternatives so the
  // user can see how to frame a decision. Sub-criteria are given as `children`.
  const EXAMPLES = [
    {
      goal: "Choose the best laptop for work",
      criteria: [
        { name: "Cost", children: ["Upfront price", "Running cost"] },
        { name: "Performance", children: ["CPU/GPU", "Memory"] },
        { name: "Battery life" },
        { name: "Build quality" },
      ],
      alternatives: ["UltraBook X", "PowerPro 15", "BudgetMate"],
    },
    {
      goal: "Hire the best candidate",
      criteria: [
        { name: "Experience" },
        { name: "Technical skills" },
        { name: "Culture fit" },
        { name: "Salary expectation" },
      ],
      alternatives: ["Candidate A", "Candidate B", "Candidate C"],
    },
    {
      goal: "Pick a holiday destination",
      criteria: [
        { name: "Cost" },
        { name: "Weather" },
        { name: "Activities" },
        { name: "Travel time" },
      ],
      alternatives: ["Bali", "Kyoto", "Lisbon"],
    },
    {
      goal: "Select a software vendor",
      criteria: [
        { name: "Price" },
        { name: "Features" },
        { name: "Support" },
        { name: "Security" },
      ],
      alternatives: ["Vendor X", "Vendor Y", "Vendor Z"],
    },
  ];

  function describeCriteria(criteria) {
    return criteria
      .map((c) => (c.children && c.children.length
        ? `${c.name} (${c.children.join(", ")})`
        : c.name))
      .join(", ");
  }

  function renderExamples() {
    const panel = $("examplesPanel");
    if (!panel) return;
    panel.innerHTML = "";

    const card = document.createElement("div");
    card.className = "card side-card";

    const head = document.createElement("div");
    head.className = "examples-head";
    head.innerHTML =
      `<h3>Not sure where to start?</h3>
       <p class="hint">Pick a sample decision to auto-fill the goal, criteria and alternatives — then make your own comparisons.</p>`;
    card.appendChild(head);

    EXAMPLES.forEach((ex) => {
      const block = document.createElement("div");
      block.className = "example";
      block.innerHTML =
        `<div class="example-goal"><span class="pin">🎯</span><span>${escapeHtml(ex.goal)}</span></div>
         <div class="example-meta"><b>Criteria:</b> ${escapeHtml(describeCriteria(ex.criteria))}</div>
         <div class="example-meta"><b>Alternatives:</b> ${escapeHtml(ex.alternatives.join(", "))}</div>`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn small use-example";
      btn.textContent = "Use this example";
      btn.addEventListener("click", () => applyExample(ex));
      block.appendChild(btn);
      card.appendChild(block);
    });

    panel.appendChild(card);
  }

  // Load an example's structure into the form (goal, hierarchy, alternatives),
  // leaving the pairwise comparisons for the user to fill in.
  function applyExample(ex) {
    state.goal = ex.goal;
    state.description = "";
    state.nextId = 1;
    state.tree = {
      id: "root",
      name: "Goal",
      children: ex.criteria.map((c) => ({
        id: newId(),
        name: c.name,
        children: (c.children || []).map((sub) => ({ id: newId(), name: sub, children: [] })),
      })),
    };
    state.alternatives = ex.alternatives.slice();
    state.respondents = [];
    state.activeRespondent = null;
    state.activeCompareKey = null;
    state.built = false;
    ensureRespondents();

    renderWorkspace();
    save();
    $("setup").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---- Init ---------------------------------------------------------------
  function bindSetup() {
    $("goalInput").addEventListener("input", (e) => {
      state.goal = e.target.value;
      save();
      if (state.built) renderResults();
    });
    $("projectDesc").addEventListener("input", (e) => {
      state.description = e.target.value;
      save();
    });
    $("addCriteria").addEventListener("click", () => addCriterion($("criteriaInput")));
    $("addAlternative").addEventListener("click", () => addAlternative($("alternativesInput")));
    $("criteriaInput").addEventListener("keydown", (e) => { if (e.key === "Enter") addCriterion($("criteriaInput")); });
    $("alternativesInput").addEventListener("keydown", (e) => { if (e.key === "Enter") addAlternative($("alternativesInput")); });
    $("buildBtn").addEventListener("click", handleBuild);
    $("downloadCsv").addEventListener("click", downloadResultsCsv);
    $("downloadXlsx").addEventListener("click", downloadResultsXlsx);

    // Project controls
    $("projectSelect").addEventListener("change", (e) => switchProject(e.target.value));
    $("newProject").addEventListener("click", () => newProject());
    $("renameProject").addEventListener("click", renameProject);
    $("dupProject").addEventListener("click", duplicateProject);
    $("deleteProject").addEventListener("click", deleteProject);

    $("loadSample").addEventListener("click", () => {
      newProject();          // open the example in its own project (keeps current work)
      sampleData();          // fill the new project's live state
      const p = activeProject();
      if (p) p.name = state.goal || "Example project";
      save();                // persist sample (name + description) into the project slot
      renderProjectSelect(); // now reflects the example's name/description tooltip
      renderWorkspace();
    });

    $("resetAll").addEventListener("click", () => {
      if (!confirm("Clear this project's goal, criteria hierarchy, alternatives and all judgements?")) return;
      applyStateData(blankData());
      ensureRespondents();
      renderWorkspace();
      save();
    });
  }

  function init() {
    bindSetup();
    renderExamples();
    loadProjects();
    applyStateData(activeProject().data);
    ensureRespondents();
    renderProjectSelect();
    renderWorkspace();
    save(); // normalise legacy data into the registry shape
  }

  document.addEventListener("DOMContentLoaded", init);
})();
