# AHP Decision Analyzer

A multi-criteria decision-analysis tool implementing the **Analytic Hierarchy Process (AHP)**
with support for a **nested criteria hierarchy** (criteria → sub-criteria → …). Built with
vanilla HTML, CSS, and JavaScript — no frameworks, no build step.

![Vanilla JS](https://img.shields.io/badge/stack-vanilla%20JS-f7df1e) ![No build](https://img.shields.io/badge/build-none-success) ![License](https://img.shields.io/badge/license-MIT-blue)

## What it does

AHP turns a messy "which option is best?" question into a structured, numeric ranking:

1. **Define the decision** — a goal, a hierarchy of criteria (with optional sub-criteria), and the alternatives.
2. **Compare** — for one or more respondents, pairwise judgements on Saaty's 1–9 scale: first weighing the criteria, then scoring the alternatives under every *leaf* criterion. All comparisons live in a single tabbed panel.
3. **Read the results** — a ranked list, the propagated criteria weights, and a full decision matrix.

Consistency is checked everywhere via Saaty's **Consistency Ratio (CR)**; anything above 10% is flagged.

## Multiple respondents (group decisions)

Add as many respondents as you like in the comparison step. Each keeps their **own** set of
pairwise judgements, and you switch between them with the respondent chips. A **Group (avg)** view
aggregates everyone using the **geometric mean of judgements** (Aggregation of Individual Judgements,
AIJ) — the standard AHP method, which keeps the combined matrix reciprocal. The group view is
read-only; the results panel shows whichever respondent (or the group) is currently selected.

## Exporting results

The Results panel has **Excel** and **CSV** download buttons. The Excel file is a real multi-tab
`.xlsx` workbook — generated entirely in the browser (a hand-built Open XML package; no libraries,
no server) — with one tab per view:

| Tab | Contents |
|-----|----------|
| **Summary** | Goal, the view exported, and the final ranking (priority + %) |
| **Criteria Weights** | Each leaf criterion's local and global weight |
| **Decision Matrix** | Every alternative's local priority per leaf, plus the final score |
| **Consistency** | CR, λmax and pass/fail for each comparison |
| **By Respondent** | Cross-tab of each respondent's scores and the group average (when >1 respondent) |

Numbers are stored as real, full-precision values (not rounded display text), so the spreadsheet
can recompute from them. The CSV export packs the same sections into one UTF-8 file for tools that
prefer CSV. Whichever respondent (or the **Group (avg)** view) is selected is the one exported.

## Nested sub-criteria

Any criterion can hold its own sub-criteria to arbitrary depth. Weights propagate down the tree:

```
global(node) = local(node within its parent) × global(parent)
```

Alternatives are only compared against **leaf** criteria, and each leaf's *global* weight is what
feeds the final aggregation — so the leaf weights always sum to 1 regardless of tree shape.

## Project structure

```
AHP/
├── index.html            # markup + script/style includes
├── package.json          # metadata + static-server scripts
├── README.md
├── LICENSE               # MIT
├── .gitignore
└── src/
    ├── css/
    │   └── styles.css    # all styling (dark theme, responsive)
    └── js/
        ├── ahp.js        # pure matrix math: eigenvector, CR, aggregation (window.AHP)
        ├── tree.js       # criteria hierarchy + weight propagation (window.AHPTree)
        └── app.js        # UI, state, and localStorage persistence
```

## Running it

It's a static site — just open `index.html` in a browser. To serve it over HTTP (recommended so
relative paths and `localStorage` behave like production):

```bash
# Node (uses `serve`)
npm start

# or Python's built-in server
npm run dev        # -> http://localhost:8000
# equivalently: python3 -m http.server 8000
```

## How the math works

Priorities are computed in full double precision (the power iteration runs to machine precision,
≈15–16 significant digits, with no intermediate rounding) and results are shown to **3 decimal
places**, so they line up with a spreadsheet rather than being masked by display rounding.

| Quantity | Method |
|----------|--------|
| Priority weights | Principal eigenvector via power iteration (to machine precision) |
| λ<sub>max</sub> | Mean of `(A·w)ᵢ / wᵢ` |
| Consistency Index | `CI = (λmax − n) / (n − 1)` |
| Consistency Ratio | `CR = CI / RI`, with Saaty's Random Index table |
| Global leaf weight | Product of local weights along the path to the root |
| Final score | `Σ_leaves  global_weight(leaf) × local_priority(alt, leaf)` |
| Group aggregation | Element-wise **geometric mean** of every respondent's matrices (AIJ) |

A matrix is treated as acceptably consistent when **CR ≤ 0.10**.

## Notes

- **Download Excel / CSV** (in the Results header) exports the analysis as a spreadsheet — final
  ranking, criteria leaf weights, the full decision matrix, consistency ratios, and a per-respondent
  score comparison. Numbers are written at full precision so the spreadsheet can recompute from them.
- All state (goal, hierarchy, respondents, judgements) is auto-saved to `localStorage`, so a reload restores your work.
- A **sample-decisions sidebar** sits beside the form: pick one (e.g. hiring a candidate, picking a holiday) to auto-fill the goal, criteria and alternatives, then make your own comparisons.
- "Load example" populates a fully-worked 2-level laptop-choice model with **two respondents** (Priya, performance-focused; Sam, budget-focused) so you can try the Group view immediately.
- No data leaves the browser.

## License

MIT — see [LICENSE](LICENSE).
