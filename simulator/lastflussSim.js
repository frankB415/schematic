/*
lastflussSim.js — DC-Lastflussanalyse (reelle Knotenpotentiale)
Erbt von nodeBaseSim.

═══════════════════════════════════════════════════════════════════
DIDAKTISCHE BASIS
═══════════════════════════════════════════════════════════════════

Dieser Simulator ist bewusst einfach gehalten — er dient als
Referenzimplementierung für das Lastfluss-Verfahren:

  1. Raster-Scan:     Lösungsraum gleichmäßig abtasten
  2. Newton-Raphson:  Arbeitspunkt iterativ verfeinern
  3. GMRES:           Lineares Gleichungssystem lösen

Alle Spannungen und Leistungen sind reell (DC).
Für AC/DC-Mischnetze → lastflussKomplexSim.

═══════════════════════════════════════════════════════════════════
KNOTENFORMULIERUNG
═══════════════════════════════════════════════════════════════════

Gesucht: Knotenspannungen U₁…Uₙ so dass die Leistungsbilanz
an jedem Knoten erfüllt ist:

  F_i(U) = ΣP_i(U) = 0   für alle i

Das ist ein nichtlineares Gleichungssystem — Newton-Raphson löst es
iterativ durch Linearisierung:

  J · ΔU = -F(U)    →    U_neu = U_alt + ΔU

  J_ij = ∂F_i/∂U_j  (Jacobi-Matrix, numerisch approximiert)

═══════════════════════════════════════════════════════════════════
SCAN-STRATEGIE
═══════════════════════════════════════════════════════════════════

Das Gleichungssystem hat mehrere Lösungen (z.B. U=0 ist immer
Fixpunkt). Der Scan sucht einen guten Startwert:

  Für jeden Knoten: scanSteps Punkte im Bereich [uMin, uMax]
  + Schaltgrenzen aller Blöcke (uMin/uMax-Werte knapp innen)

  Bewertung: relatives Residuum rrᵢ = |F_i| / flow_i
  → Punkte mit flow_i=0 werden verworfen (kein Energiefluss)
  → Die besten scanTop Kandidaten werden für Newton verwendet

═══════════════════════════════════════════════════════════════════
LADEREIHENFOLGE
═══════════════════════════════════════════════════════════════════

  baseSim.js
  nodeBaseSim.js
  lastflussSim.js
*/

class lastflussSim extends nodeBaseSim {

    constructor(nodes, opts = {}) {
        super(nodes, opts);
        // Logging: Knoten-Belegung ausgeben
        if (this._logging) this._logNodes();
    }

    _logNodes() {
        console.log('[lastflussSim] Knoten-Belegung:');
        for (const node of this._nodes) {
            const hidden = node.hidden ? ' (intern)' : '';
            const entries = [];
            for (const block of node.blocks) {
                const assign = this._connectorMap.get(block) || {};
                const mine   = Object.entries(assign)
                    .filter(([, nid]) => nid === node.id)
                    .map(([cn]) => cn);
                entries.push(`${block._label ?? block.constructor.name}[${mine.join(',')}]`);
            }
            console.log(`  Knoten ${node.id}${hidden}: ${entries.join('  +  ')}`);
        }
    }

    // ── Hilfsfunktionen ───────────────────────────────────────────────────────

    /** Summe aller Leistungsbeiträge an einem Knoten */
    _sumPowerForNode(node, nodeVoltages) {
        let sum = 0;
        for (const block of node.blocks) {
            const v      = this._voltagesForBlock(block, nodeVoltages);
            const powers = block.calcPower(v);
            const assign = this._connectorMap.get(block) || {};
            for (const [connName, nodeId] of Object.entries(assign))
                if (nodeId === node.id) sum += powers[connName] ?? 0;
            // Versteckte Knoten
            if (typeof block.getHiddenNodes === 'function') {
                for (const hn of block.getHiddenNodes()) {
                    if (hn.id === node.id && powers[hn.id] != null)
                        sum += powers[hn.id];
                }
            }
        }
        return sum;
    }

    /** Obergrenze für Knotenspannung (aus block.voc oder node.uMax) */
    _uMaxForNode(node) {
        if (node.uMax != null) return node.uMax;
        let uMax = 0;
        for (const block of node.blocks) {
            const voc = block.voc ?? block.getParam?.('voc') ?? 0;
            if (voc > 0) uMax = Math.max(uMax, voc * 0.99);
        }
        return uMax > 0 ? uMax : 100;
    }

    // ── Residualvektor ────────────────────────────────────────────────────────

    /**
     * F(U) = [ΣP₁, ΣP₂, ..., ΣPₙ]
     * Leistungsbilanz an jedem Knoten — soll 0 sein.
     */
    _residual(nodeVoltages) {
        return this._nodes.map(n => this._sumPowerForNode(n, nodeVoltages));
    }

    // ── Raster-Scan ──────────────────────────────────────────────────────────

    /**
     * Leistungsfluss je Knoten: Summe aller positiven Beiträge.
     * Wird für das relative Residuum benötigt.
     */
    _flowPerNode(nodeVoltages) {
        return this._nodes.map(node => {
            let flow = 0;
            for (const block of node.blocks) {
                const v      = this._voltagesForBlock(block, nodeVoltages);
                const powers = block.calcPower(v);
                const assign = this._connectorMap.get(block) || {};
                for (const [connName, nodeId] of Object.entries(assign))
                    if (nodeId === node.id && (powers[connName] ?? 0) > 0)
                        flow += powers[connName];
            }
            return flow;
        });
    }

    _scan() {
        const steps  = this._scanSteps;
        const ranges = this._nodes.map(n => ({
            id:   n.id,
            uMin: n.uMin ?? 1,
            uMax: this._uMaxForNode(n),
        }));

        // Scan-Punkte je Knoten: gleichmäßig + Schaltgrenzen der Blöcke
        const pointsFor = (nodeIdx) => {
            const { uMin, uMax } = ranges[nodeIdx];
            const node = this._nodes[nodeIdx];
            const pts  = new Set();
            for (let i = 0; i < steps; i++)
                pts.add(uMin + (uMax - uMin) * (i + 0.5) / steps);
            for (const block of node.blocks) {
                if (block.uMin != null) { pts.add(block.uMin + 0.1); pts.add(block.uMin + 1); }
                if (block.uMax != null) { pts.add(block.uMax - 0.1); pts.add(block.uMax - 1); }
            }
            return [...pts].filter(u => u >= uMin && u <= uMax);
        };

        const allPoints  = ranges.map((_, i) => pointsFor(i));
        const candidates = [];

        // Kartesisches Produkt über alle Knoten
        const scan = (dim, current) => {
            if (dim === ranges.length) {
                const F     = this._residual(current);
                const flows = this._flowPerNode(current);
                // Relatives Residuum: |F_i|/flow_i
                // flow_i=0 → Infinity → Punkt automatisch aussortiert
                const relSq = F.reduce((s, fi, i) => {
                    const fl = flows[i];
                    return fl > 0 ? s + (fi / fl) ** 2 : Infinity;
                }, 0);
                candidates.push({ voltages: new Map(current), relSq });
                return;
            }
            const { id } = ranges[dim];
            for (const u of allPoints[dim]) {
                current.set(id, u);
                scan(dim + 1, current);
            }
        };
        scan(0, new Map(ranges.map(r => [r.id, (r.uMin + r.uMax) / 2])));

        candidates.sort((a, b) => a.relSq - b.relSq);
        const top = candidates.filter(c => isFinite(c.relSq)).slice(0, this._scanTop);

        if (this._logging) {
            this._log(`Scan: ${candidates.length} Punkte, beste ${top.length}:`);
            top.forEach((c, i) => {
                const rel = Math.sqrt(c.relSq) * 100;
                this._log(`  #${i+1} rel=${rel.toFixed(1)}%`);
            });
        }
        return top.map(c => c.voltages);
    }

    // ── Jacobi-Matrix ────────────────────────────────────────────────────────

    /**
     * J_ij = ∂F_i/∂U_j  — numerisch via Vorwärtsdifferenz.
     * dU wird relativ zur aktuellen Spannung gewählt für bessere Konditionierung.
     */
    _jacobian(nodeVoltages, F0) {
        const n  = this._nodes.length;
        const J  = [];
        for (let j = 0; j < n; j++) {
            const dU       = Math.max(this._dU, Math.abs(nodeVoltages.get(this._nodes[j].id) ?? 0) * 1e-4);
            const perturbed = new Map(nodeVoltages);
            perturbed.set(this._nodes[j].id, (nodeVoltages.get(this._nodes[j].id) ?? 0) + dU);
            const Fp = this._residual(perturbed);
            J.push(Fp.map((fp, i) => (fp - F0[i]) / dU));
        }
        // Transponieren: J[i][j] = ∂F_i/∂U_j
        return J[0].map((_, i) => J.map(col => col[i]));
    }

    // ── Newton-Raphson ───────────────────────────────────────────────────────

    /**
     * Newton-Raphson mit Armijo Line-Search.
     * Startet von startVoltages, iteriert bis Konvergenz oder maxIter.
     *
     * Armijo Line-Search:
     *   Schrittweite alpha halbieren bis ||F(U+α·ΔU)|| < ||F(U)||
     *   → verhindert Divergenz bei schlechtem Startwert
     */
    _newton(startVoltages) {
        const nodeVoltages = new Map(startVoltages);
        let converged = false, iter = 0;

        while (iter < this._maxIter) {
            const F          = this._residual(nodeVoltages);
            const maxResidual = Math.max(...F.map(Math.abs));

            if (this._logging) {
                this._nodes.forEach((n, i) =>
                    this._log(`Iter ${iter}  ${n.id}: U=${(nodeVoltages.get(n.id)??0).toFixed(4)}V  F=${F[i].toFixed(4)}W`)
                );
            }

            iter++;
            if (maxResidual < this._epsilon) { converged = true; break; }

            // Lineares System lösen: J·ΔU = -F
            const J  = this._jacobian(nodeVoltages, F);
            const dU = this._gmres(J, F);

            // Armijo Line-Search
            const f0norm = F.reduce((s, f) => s + f * f, 0);
            let alpha = this._damp;
            for (let ls = 0; ls < 12; ls++) {
                const cand = new Map();
                this._nodes.forEach((n, i) => {
                    const uOld = nodeVoltages.get(n.id) ?? 0;
                    const uMin = n.uMin ?? 1;
                    const uMax = this._uMaxForNode(n);
                    cand.set(n.id, Math.max(uMin, Math.min(uMax, uOld - alpha * dU[i])));
                });
                const Fnew  = this._residual(cand);
                const fnorm = Fnew.reduce((s, f) => s + f * f, 0);
                if (fnorm < f0norm) { for (const [k, v] of cand) nodeVoltages.set(k, v); break; }
                alpha *= 0.5;
                if (ls === 11) for (const [k, v] of cand) nodeVoltages.set(k, v);
            }
        }

        const F      = this._residual(nodeVoltages);
        const allZero = [...nodeVoltages.values()].every(u => u < 1);
        if (allZero) converged = false;
        return { nodeVoltages, converged, iter, residual: allZero ? Infinity : Math.max(...F.map(Math.abs)) };
    }

    // ── Ergebnis anwenden ────────────────────────────────────────────────────

    _applyResult(best, converged, iter) {
        const { nodeVoltages } = best;

        const appliedBlocks = new Set();
        const powers = new Map();
        for (const node of this._nodes) {
            for (const block of node.blocks) {
                if (appliedBlocks.has(block)) continue;
                appliedBlocks.add(block);
                const v = this._voltagesForBlock(block, nodeVoltages);
                powers.set(block, block.calcPower(v));
                block.applyOperatingPoint(v);
            }
        }

        if (this._logging) {
            this._log(`Ergebnis nach ${iter} Iterationen${converged ? '' : ' — NICHT KONVERGIERT'}`);
            for (const node of this._nodes) {
                const u   = nodeVoltages.get(node.id) ?? 0;
                const sum = this._sumPowerForNode(node, nodeVoltages);
                this._log(`  Knoten ${node.id}: U=${u.toFixed(4)} V  ΣP=${sum.toFixed(4)} W`);
            }
        }

        return { voltages: nodeVoltages, powers, converged, iterations: iter };
    }
}

if (typeof window !== 'undefined') window.lastflussSim = lastflussSim;