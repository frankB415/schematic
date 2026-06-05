/*
lastflussKomplexSim.js — AC/DC-Lastflussanalyse (komplexe Knotenpotentiale)
Erbt von lastflussSim.

═══════════════════════════════════════════════════════════════════
ERWEITERUNGEN GEGENÜBER lastflussSim
═══════════════════════════════════════════════════════════════════

lastflussSim löst DC-Netze mit reellen Spannungen (number).
lastflussKomplexSim erweitert das auf AC+DC-Mischnetze:

  DC-Knoten: Spannung = number         → 1 Variable  (u)
  AC-Knoten: Spannung = {re, im}       → 2 Variablen (re, im)

Knotentyp wird automatisch erkannt — kein type-Feld nötig.

═══════════════════════════════════════════════════════════════════
ÜBERSCHRIEBENE METHODEN
═══════════════════════════════════════════════════════════════════

  _voltagesForBlock()  — komplexe Spannungen an Blöcke übergeben
  _scan()              — 2D-Scan für AC (Amplitude + Winkel)
  _residual()          — F = [ΣP, ΣQ] für AC, F = [ΣP] für DC
  _newton()            — Zustandsvektor statt Map, Gauß-Elimination
  _applyResult()       — Spannungsausgabe mit Phasenwinkeln

═══════════════════════════════════════════════════════════════════
LADEREIHENFOLGE
═══════════════════════════════════════════════════════════════════

  baseSim.js
  nodeBaseSim.js
  lastflussSim.js
  lastflussKomplexSim.js
*/

class lastflussKomplexSim extends lastflussSim {

    constructor(nodes, opts = {}) {
        super(nodes, opts);
        // AC/DC-Typen erkennen (nach super() da _connectorMap schon gebaut)
        this._nodeTypes = this._detectNodeTypes();

        if (this._logging) this._logKomplexNodes();
    }

    _logKomplexNodes() {
        const nAC = [...this._nodeTypes.values()].filter(t => t === 'ac').length;
        const nDC = [...this._nodeTypes.values()].filter(t => t === 'dc').length;
        const dof = nAC * 2 + nDC;
        const varNames = [];
        for (const node of this._nodes)
            if (this._nodeTypes.get(node.id) === 'ac') varNames.push(`${node.id}.re`, `${node.id}.im`);
            else varNames.push(node.id);
        console.log(`[lastflussKomplexSim] ${this._nodes.length} Knoten (${nAC} AC + ${nDC} DC) → ${dof} Solver-Variablen: [ ${varNames.join(', ')} ]`);
        for (const node of this._nodes) {
            const type   = this._nodeTypes.get(node.id).toUpperCase();
            const hidden = node.hidden ? ' (intern)' : '';
            const assign = [];
            for (const block of node.blocks) {
                const cm = this._connectorMap.get(block) ?? {};
                const connNames = Object.entries(cm)
                    .filter(([, nid]) => nid === node.id)
                    .map(([cn]) => cn);
                assign.push(`${block._label}[${connNames.join(',')}]`);
            }
            console.log(`  ${node.id}${hidden} (${type}): ${assign.join('  +  ')}`);
        }
    }

    /** Überschreibt nodeBaseSim._logSolverVars: AC-Knoten als .re/.im auffalten */
    _logSolverVars(candidates) {
        if (!candidates.length) return;
        const realVarNames = [];
        for (const node of this._nodes) {
            if (this._nodeTypes.get(node.id) === 'ac') {
                realVarNames.push(`${node.id}.re`, `${node.id}.im`);
            } else {
                realVarNames.push(node.id);
            }
        }
        console.log(`[lastflussKomplexSim] Reelle Variablen (${realVarNames.length}): [ ${realVarNames.join(', ')} ]`);
    }

    // ── Komplexe Hilfsfunktionen ──────────────────────────────────────────────
    // Eigenständig — Simulator ist unabhängig von lastflussKomplexBlock

    _toC(v)       { return typeof v === 'number' ? { re: v, im: 0 } : (v ?? { re: 0, im: 0 }); }
    _cAbs(a)      { return Math.sqrt(a.re**2 + a.im**2); }
    _cAdd(a, b)   { return { re: a.re + b.re, im: a.im + b.im }; }
    _cScale(a, s) { return { re: a.re * s, im: a.im * s }; }

    // ── Knotentyp-Erkennung ───────────────────────────────────────────────────

    /**
     * AC-Knoten: mindestens ein angeschlossener Block gibt {re,im} zurück.
     * DC-Knoten: alle Blöcke geben number zurück.
     * Nur der Connector des jeweiligen Knotens wird geprüft.
     */
    _detectNodeTypes() {
        const types = new Map();
        for (const node of this._nodes) {
            // Versteckter Knoten: Typ direkt vom Block via getHiddenNodes() holen
            if (node.hidden) {
                let nodeType = 'dc';
                for (const block of node.blocks) {
                    if (typeof block.getHiddenNodes !== 'function') continue;
                    for (const hn of block.getHiddenNodes()) {
                        if (hn.id === node.id && hn.type) {
                            nodeType = hn.type;   // 'ac' oder 'dc' vom Block
                        }
                    }
                }
                types.set(node.id, nodeType);
                continue;
            }
            // Normaler Knoten: Typ aus calcPower erkennen
            const testVolt = new Map(this._nodes.map(n => [n.id, { re: 1, im: 0 }]));
            let isAC = false;
            outer: for (const block of node.blocks) {
                const v = this._voltagesForBlock(block, testVolt);
                let powers;
                try { powers = block.calcPower(v); } catch(e) { continue; }
                const assign = this._connectorMap.get(block) ?? {};
                for (const [connName, nodeId] of Object.entries(assign)) {
                    if (nodeId !== node.id) continue;
                    const p = powers[connName];
                    if (p && typeof p === 'object' && 're' in p) { isAC = true; break outer; }
                }
            }
            types.set(node.id, isAC ? 'ac' : 'dc');
        }
        return types;
    }

    // ── Spannungen für Block ──────────────────────────────────────────────────

    /**
     * Überschreibt nodeBaseSim._voltagesForBlock:
     * Reelle Blöcke (lastflussBlock) bekommen |u| statt {re,im}.
     */
    _voltagesForBlock(block, voltageMap) {
        const assign = this._connectorMap.get(block) ?? {};
        const v = {};
        for (const [connName, nodeId] of Object.entries(assign)) {
            const raw       = voltageMap.get(nodeId) ?? (this._nodeTypes?.get(nodeId) === 'ac' ? { re: 0, im: 0 } : 0);
            const isComplex = raw !== null && typeof raw === 'object' && 're' in raw;
            v[connName] = (isComplex && !(block instanceof lastflussKomplexBlock))
                ? this._cAbs(raw)
                : raw;
        }
        // Versteckte Knoten zusätzlich übergeben
        if (typeof block.getHiddenNodes === 'function') {
            for (const hn of block.getHiddenNodes()) {
                const raw = voltageMap.get(hn.id);
                if (raw !== undefined) v[hn.id] = raw;
            }
        }
        return v;
    }

    // ── Zustandsvektor ────────────────────────────────────────────────────────

    _dim(nodeId) { return this._nodeTypes.get(nodeId) === 'ac' ? 2 : 1; }

    _xToVoltages(x) {
        const map = new Map();
        let idx = 0;
        for (const node of this._nodes) {
            if (this._nodeTypes.get(node.id) === 'ac') {
                map.set(node.id, { re: x[idx], im: x[idx+1] });
                idx += 2;
            } else {
                map.set(node.id, x[idx++]);
            }
        }
        return map;
    }

    _voltagesToX(voltageMap) {
        const x = [];
        for (const node of this._nodes) {
            const v = voltageMap.get(node.id);
            if (this._nodeTypes.get(node.id) === 'ac') {
                const vc = this._toC(v);
                x.push(vc.re, vc.im);
            } else {
                x.push(typeof v === 'number' ? v : this._cAbs(v));
            }
        }
        return x;
    }

    // ── Residualvektor ────────────────────────────────────────────────────────

    /**
     * Überschreibt lastflussSim._residual:
     * AC-Knoten liefern [ΣP, ΣQ], DC-Knoten nur [ΣP].
     */
    _residual(x) {
        const voltageMap = this._xToVoltages(x);
        const balance = new Map(this._nodes.map(n => [
            n.id,
            this._nodeTypes.get(n.id) === 'ac' ? { re: 0, im: 0 } : 0
        ]));

        const processedBlocks = new Set();
        for (const node of this._nodes) {
            for (const block of node.blocks) {
                if (processedBlocks.has(block)) continue;
                processedBlocks.add(block);
                const v = this._voltagesForBlock(block, voltageMap);
                let powers;
                try { powers = block.calcPower(v); } catch(e) { continue; }
                // Normale Connectoren
                const assign = this._connectorMap.get(block) ?? {};
                for (const [connName, nodeId] of Object.entries(assign)) {
                    const p = powers[connName];
                    if (p == null) continue;
                    const pc  = this._toC(p);
                    const cur = balance.get(nodeId);
                    if (typeof cur === 'number') balance.set(nodeId, cur + pc.re);
                    else                         balance.set(nodeId, this._cAdd(cur, pc));
                }
                // Versteckte Knoten
                if (typeof block.getHiddenNodes === 'function') {
                    for (const hn of block.getHiddenNodes()) {
                        const p = powers[hn.id];
                        if (p == null || !balance.has(hn.id)) continue;
                        const pc  = this._toC(p);
                        const cur = balance.get(hn.id);
                        if (typeof cur === 'number') balance.set(hn.id, cur + pc.re);
                        else                         balance.set(hn.id, this._cAdd(cur, pc));
                    }
                }
            }
        }

        const F = [];
        for (const node of this._nodes) {
            const b = balance.get(node.id);
            if (this._nodeTypes.get(node.id) === 'ac') F.push(b.re, b.im);
            else                                        F.push(typeof b === 'number' ? b : b.re);
        }
        return F;
    }

    // ── Scan ─────────────────────────────────────────────────────────────────

    /**
     * Überschreibt lastflussSim._scan:
     * AC-Knoten werden in Polarkoordinaten gescannt (Amplitude + Winkel).
     */
    _scan() {
        const steps      = this._scanSteps;
        const candidates = [];

        const ranges = this._nodes.map(node => {
            const uMin = node.uMin ?? 10;
            const uMax = node.uMax ?? (this._nodeTypes.get(node.id) === 'ac' ? 1000 : 100);
            if (this._nodeTypes.get(node.id) === 'ac') {
                const amps = Array.from({ length: steps }, (_, i) => uMin + (uMax - uMin) * i / (steps - 1));
                const phis = [-30, -15, 0, 15, 30].map(d => d * Math.PI / 180);
                return { amps, phis };
            } else {
                return { vals: Array.from({ length: steps }, (_, i) => uMin + (uMax - uMin) * i / (steps - 1)) };
            }
        });

        const relResidual = (F, x) => {
            const voltageMap = this._xToVoltages(x);
            let sum = 0, idx = 0;
            for (const node of this._nodes) {
                let flow = 0;
                for (const block of node.blocks) {
                    const v = this._voltagesForBlock(block, voltageMap);
                    let powers; try { powers = block.calcPower(v); } catch(e) { continue; }
                    const assign = this._connectorMap.get(block) ?? {};
                    for (const [cn, nid] of Object.entries(assign)) {
                        if (nid !== node.id) continue;
                        const p = powers[cn]; if (p == null) continue;
                        flow += Math.abs(this._toC(p).re);
                    }
                }
                const norm = flow > 1 ? flow : Infinity;
                if (this._nodeTypes.get(node.id) === 'ac') {
                    sum += (F[idx]/norm)**2 + (F[idx+1]/norm)**2; idx += 2;
                } else {
                    sum += (F[idx]/norm)**2; idx += 1;
                }
            }
            return Math.sqrt(sum) * 100;
        };

        const buildCombinations = (idx, current) => {
            if (idx === this._nodes.length) {
                const x   = current.flat();
                const F   = this._residual(x);
                const rel = relResidual(F, x);
                if (isFinite(rel)) candidates.push({ x, rel });
                return;
            }
            const r = ranges[idx];
            if (r.amps) {
                for (const amp of r.amps)
                    for (const phi of r.phis)
                        buildCombinations(idx + 1, [...current, [amp * Math.cos(phi), amp * Math.sin(phi)]]);
            } else {
                for (const val of r.vals)
                    buildCombinations(idx + 1, [...current, [val]]);
            }
        };

        buildCombinations(0, []);
        candidates.sort((a, b) => a.rel - b.rel);
        this._log(`Scan: ${candidates.length} Punkte, beste ${this._scanTop}:`);
        candidates.slice(0, this._scanTop).forEach((c, i) => this._log(`  #${i+1} rel=${c.rel.toFixed(1)}%`));
        return candidates.slice(0, this._scanTop).map(c => c.x);
    }

    // ── Newton-Raphson ────────────────────────────────────────────────────────

    /**
     * Überschreibt lastflussSim._newton:
     * Arbeitet mit Zustandsvektor x[] statt Map, Gauß-Elimination statt GMRES.
     */
    _solveLinear(J, b) {
        const n = b.length;
        const A = J.map((row, i) => [...row, b[i]]);
        for (let col = 0; col < n; col++) {
            let maxRow = col;
            for (let row = col + 1; row < n; row++)
                if (Math.abs(A[row][col]) > Math.abs(A[maxRow][col])) maxRow = row;
            [A[col], A[maxRow]] = [A[maxRow], A[col]];
            if (Math.abs(A[col][col]) < 1e-14) continue;
            for (let row = col + 1; row < n; row++) {
                const f = A[row][col] / A[col][col];
                for (let k = col; k <= n; k++) A[row][k] -= f * A[col][k];
            }
        }
        const x = new Array(n).fill(0);
        for (let i = n - 1; i >= 0; i--) {
            let s = A[i][n];
            for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j];
            x[i] = Math.abs(A[i][i]) > 1e-14 ? s / A[i][i] : 0;
        }
        return x;
    }

    _buildClamp() {
        const lo = [], hi = [];
        for (const node of this._nodes) {
            const uMin = node.uMin ?? 0;
            const uMax = node.uMax ?? 1e9;
            if (this._nodeTypes.get(node.id) === 'ac') {
                lo.push(-uMax, -uMax); hi.push(uMax, uMax);
            } else {
                lo.push(uMin); hi.push(uMax);
            }
        }
        return { lo, hi };
    }

    _jacobian(x) {
        const F0 = this._residual(x);
        const J  = Array.from({ length: F0.length }, () => new Array(x.length).fill(0));
        for (let j = 0; j < x.length; j++) {
            const xp = [...x];
            xp[j] += this._dU;
            const Fp = this._residual(xp);
            for (let i = 0; i < F0.length; i++) J[i][j] = (Fp[i] - F0[i]) / this._dU;
        }
        return { J, F0 };
    }

    _newton(x0) {
        const { lo, hi } = this._buildClamp();
        const clamp = x => x.map((v, i) => Math.max(lo[i], Math.min(hi[i], v)));
        let x = clamp([...x0]);
        for (let iter = 0; iter < this._maxIter; iter++) {
            const { J, F0 } = this._jacobian(x);
            const norm = Math.sqrt(F0.reduce((s, v) => s + v*v, 0));
            if (norm < this._epsilon) return { x, converged: true, iter, residual: norm };
            const dx    = this._solveLinear(J, F0.map(v => -v));
            let   alpha = 1.0;
            for (let ls = 0; ls < 8; ls++) {
                const xn = clamp(x.map((v, i) => v + alpha * dx[i]));
                const nn = Math.sqrt(this._residual(xn).reduce((s, v) => s + v*v, 0));
                if (nn < norm) { x = xn; break; }
                alpha *= this._damp;
            }
        }
        const F = this._residual(x);
        return { x, converged: false, iter: this._maxIter, residual: Math.sqrt(F.reduce((s,v)=>s+v*v,0)) };
    }

    // ── Ergebnis anwenden ────────────────────────────────────────────────────

    _applyResult(best, converged, iter) {
        const { x } = best;
        const voltageMap = this._xToVoltages(x);

        if (this._logging) {
            for (const node of this._nodes) {
                let nodeSum = 0;
                for (const block of node.blocks) {
                    const v = this._voltagesForBlock(block, voltageMap);
                    let pw; try { pw = block.calcPower(v); } catch(e) { continue; }
                    const assign = this._connectorMap.get(block) ?? {};
                    for (const [cn, nid] of Object.entries(assign)) {
                        if (nid !== node.id) continue;
                        const p = pw[cn]; if (p == null) continue;
                        const pc = this._toC(p);
                        nodeSum += pc.re;
                        console.log(`[solve] ${node.id} | ${block._label}.${cn}: P=${pc.re.toFixed(1)} Q=${pc.im.toFixed(1)} W`);
                    }
                }
                console.log(`[solve] ${node.id} | Summe P=${nodeSum.toFixed(1)} W`);
            }
        }

        const appliedBlocks = new Set();
        const powers = new Map();
        for (const node of this._nodes) {
            for (const block of node.blocks) {
                if (appliedBlocks.has(block)) continue;
                appliedBlocks.add(block);
                const v = this._voltagesForBlock(block, voltageMap);
                try { powers.set(block, block.calcPower(v)); block.applyOperatingPoint(v); }
                catch(e) { this._log('applyOperatingPoint Fehler:', e.message); }
            }
        }

        if (this._logging) {
            console.log(`[lastflussKomplexSim] Ergebnis nach ${iter} Iterationen${converged ? '' : ' — NICHT KONVERGIERT'}`);
            for (const node of this._nodes) {
                const v    = voltageMap.get(node.id);
                const vStr = typeof v === 'number'
                    ? `${v.toFixed(2)} V`
                    : `${Math.sqrt(v.re**2+v.im**2).toFixed(2)} V ∠ ${(Math.atan2(v.im,v.re)*180/Math.PI).toFixed(1)}°`;
                if (!node.hidden) console.log(`  Knoten ${node.id}: U=${vStr}`);
            }
        }

        return { voltages: voltageMap, powers, converged, iterations: iter };
    }
}

if (typeof window !== 'undefined') window.lastflussKomplexSim = lastflussKomplexSim;