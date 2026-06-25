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

  _xToVoltages()       — x-Vektor → Map<nodeId, {re,im}|number>
  _voltagesToX()       — Map → x-Vektor (für Nachlauf)
  _voltagesForBlock()  — komplexe Spannungen an Blöcke übergeben
  _residual()          — F = [ΣI_re, ΣI_im] fuer AC, F = [ΣI] fuer DC (Einheit: A)
  _scan()              — Startpunkt (Mitte der Connection-Ranges)
  _buildClamp()        — ±uMax für AC re/im
  _dim()               — 2 für AC, 1 für DC
  _applyResult()       — Spannungsausgabe mit Phasenwinkeln
  _logNewtonIter()     — Hook: Iter-Log mit Amplitude + Winkel

  Newton, Jacobian, GMRES, Line-Search — geerbt von nodeBaseSim

═══════════════════════════════════════════════════════════════════
LADEREIHENFOLGE
═══════════════════════════════════════════════════════════════════

  baseSim.js
  nodeBaseSim.js
  lastflussSim.js
  lastflussKomplexSim.js
*/

class lastflussKomplexSim extends nodeBaseSim {

    constructor(blocksOrNodes, connectionsOrOpts = {}, opts = {}) {
        super(blocksOrNodes, connectionsOrOpts, opts);
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
            // Normaler Knoten: Typ aus calcCurrent erkennen
            const testVolt = new Map(this._nodes.map(n => [n.id, { re: 1, im: 0 }]));
            let isAC = false;
            outer: for (const block of node.blocks) {
                const v = this._voltagesForBlock(block, testVolt);
                let currents;
                try { currents = block.calcCurrent(v); } catch(e) { continue; }
                const assign = this._connectorMap.get(block) ?? {};
                for (const [connName, nodeId] of Object.entries(assign)) {
                    if (nodeId !== node.id) continue;
                    const ic = currents[connName];
                    if (ic && typeof ic === 'object' && 're' in ic) { isAC = true; break outer; }
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
            v[connName] = (isComplex && !(typeof lastflussKomplexBlock !== 'undefined' && block instanceof lastflussKomplexBlock))
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

    /** Überschreibt nodeBaseSim._buildClamp: AC-Knoten brauchen ±uMax für re und im */
    _buildClamp() {
        const lo = [], hi = [];
        for (const node of this._nodes) {
            const uMin = this._uClampMin(node);
            const uMax = this._uClampMax(node);
            if (this._nodeTypes.get(node.id) === 'ac') {
                lo.push(-uMax, -uMax); hi.push(uMax, uMax);
            } else {
                lo.push(uMin); hi.push(uMax);
            }
        }
        return { lo, hi };
    }

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
     * Ueberschreibt lastflussSim._residual:
     * AC-Knoten liefern [ΣIre, ΣIim], DC-Knoten nur [ΣI].
     * Einheit: Ampere. Gleichgewicht: Σ I = 0.
     */
    _residual(x) {
        const voltageMap = Array.isArray(x) ? this._xToVoltages(x) : x;
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
                let currents;
                try { currents = block.calcCurrent(v); } catch(e) { continue; }
                // Normale Connectoren
                const assign = this._connectorMap.get(block) ?? {};
                for (const [connName, nodeId] of Object.entries(assign)) {
                    const ic = currents[connName];
                    if (ic == null) continue;
                    const icc = this._toC(ic);
                    const cur = balance.get(nodeId);
                    if (typeof cur === 'number') balance.set(nodeId, cur + icc.re);
                    else                         balance.set(nodeId, this._cAdd(cur, icc));
                }
                // Versteckte Knoten
                if (typeof block.getHiddenNodes === 'function') {
                    for (const hn of block.getHiddenNodes()) {
                        // versteckte Knoten koennen per id oder connectorName addressiert sein
                        const ic = currents[hn.id] ?? currents[hn.connectorName];
                        if (ic == null || !balance.has(hn.id)) continue;
                        const icc = this._toC(ic);
                        const cur = balance.get(hn.id);
                        if (typeof cur === 'number') balance.set(hn.id, cur + icc.re);
                        else                         balance.set(hn.id, this._cAdd(cur, icc));
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
     * Startvektor: Mittelpunkt jedes Connection-Bereichs, AC mit phi=0.
     * Kein Rasterscan — Connection-Ranges muessen den Betriebspunkt einschliessen.
     */
    _scan() {
        const x0  = [];
        let   xIdx = 0;
        for (const node of this._nodes) {
            const uMid = (this._uMinForNode(node) + this._uMaxForNode(node)) / 2;
            if (this._nodeTypes.get(node.id) === 'ac') {
                x0.push(uMid, 0);
            } else {
                x0.push(uMid);
            }
        }
        if (this._logging) {
            const parts = [];
            let idx = 0;
            for (const node of this._nodes) {
                const isAC = this._nodeTypes.get(node.id) === 'ac';
                if (isAC) {
                    parts.push(`${node.id}: ${Math.sqrt(x0[idx]**2+x0[idx+1]**2).toFixed(0)}V \u22200\u00b0`);
                    idx += 2;
                } else {
                    parts.push(`${node.id}: ${x0[idx].toFixed(0)}V`);
                    idx += 1;
                }
            }
            this._log(`Startpunkt: ${parts.join('  ')}`);
        }
        return [x0];
    }

    // ── HELM (Holomorphic Embedding Load Flow Method) ────────────────────────
    //
    // Idee: Ersetze F(x) = 0 durch F(x(s), s) = 0 mit s in [0,1].
    // Bei s=0 ist die Loesung trivial (x0 = Prescan-Mitte).
    // Bei s=1 ist es das echte Problem.
    // x(s) wird als Potenzreihe entwickelt: x(s) = x0 + x1*s + x2*s^2 + ...
    // Jeder Koeffizient xk loest ein LINEARES System J0 * xk = rhs_k.
    // Die Reihe wird mit Pade-Approximanten nach s=1 fortgesetzt.
    //
    // Fuer quadratische F(x) = A*x + B + C(x,x):
    //   Ordnung 0: A*x0 + B(s=0) = 0  (trivial, x0 = Startpunkt)
    //   Ordnung k: A*xk = -sum_{j=1}^{k-1} C(xj, x_{k-j}) - B_k
    // Die Jacobian J0 = A + 2*C(x0,.) wird einmalig faktorisiert.
    //
    // Fuer allgemeine (nichtlineare) F verwenden wir eine vereinfachte Version:
    // wir bauen die Reihe numerisch auf durch schrittweise Linearisierung
    // am aktuellen Entwicklungspunkt x0.

    _helm(x0, { maxOrder = 20, padeDeg = 8 } = {}) {
        const n      = x0.length;
        const tol    = this._epsilon;

        // Jacobian und Residuum am Startpunkt
        const { J, F0 } = this._jacobian(x0);
        const normF0 = Math.sqrt(F0.reduce((s,v) => s+v*v, 0));
        if (normF0 < tol) return { x: x0, converged: true, iter: 0, residual: normF0 };

        // LU-Zerlegung von J (einmalig) via Gauss mit Pivoting
        const LU  = J.map(r => [...r]);
        const piv = Array.from({length: n}, (_, i) => i);
        for (let k = 0; k < n; k++) {
            // Pivot suchen
            let maxVal = Math.abs(LU[k][k]), maxRow = k;
            for (let i = k+1; i < n; i++) {
                if (Math.abs(LU[i][k]) > maxVal) { maxVal = Math.abs(LU[i][k]); maxRow = i; }
            }
            if (maxRow !== k) {
                [LU[k], LU[maxRow]] = [LU[maxRow], LU[k]];
                [piv[k], piv[maxRow]] = [piv[maxRow], piv[k]];
            }
            if (Math.abs(LU[k][k]) < 1e-14) continue;
            for (let i = k+1; i < n; i++) {
                const f = LU[i][k] / LU[k][k];
                for (let j = k; j < n; j++) LU[i][j] -= f * LU[k][j];
                LU[i][k] = f;
            }
        }
        const luSolve = (b) => {
            const bp = piv.map(i => b[i]);
            // Vorwaerts
            for (let i = 0; i < n; i++)
                for (let j = 0; j < i; j++) bp[i] -= LU[i][j] * bp[j];
            // Rueckwaerts
            for (let i = n-1; i >= 0; i--) {
                for (let j = i+1; j < n; j++) bp[i] -= LU[i][j] * bp[j];
                bp[i] /= LU[i][i];
            }
            return bp;
        };

        // Koeffizienten der Potenzreihe x(s) = sum_k  c[k] * s^k
        // c[0] = x0 (Startpunkt)
        // c[k] = luSolve( -(F(x0 + sum_{j=1}^k c[j]*s^j) - F(x0)) / s^k )
        // Wir bauen iterativ auf:
        const c = [x0.slice()];  // c[0]

        // Erste Naherung: Newton-Schritt (= erster Koeffizient)
        const c1 = luSolve(F0.map(v => -v));
        c.push(c1);

        // Hohere Ordnungen: nichtlineare Korrektur via numerischer Differenz
        for (let k = 2; k <= maxOrder; k++) {
            // x_partial = x0 + sum_{j=1}^{k-1} c[j] * 1^j  (bei s=1)
            const xp = x0.slice();
            for (let j = 1; j < k; j++)
                for (let i = 0; i < n; i++) xp[i] += c[j][i];

            // F(xp): nichtlinearer Rest
            const Fk = this._residual(xp);

            // Linearer Anteil am Startpunkt: J * (xp - x0)
            const dx = xp.map((v,i) => v - x0[i]);
            const Jdx = J.map(row => row.reduce((s,a,j) => s + a*dx[j], 0));

            // Nichtlinearer Rest dieser Ordnung: Fk - Jdx - F0
            // (zieht den linearen Teil ab, der schon durch c1 abgedeckt ist)
            const rhs = Fk.map((v,i) => -(v - Jdx[i] - F0[i]));
            const ck  = luSolve(rhs);
            c.push(ck);

            // Pruefe ob Reihe konvergiert (Norm der neuen Koeffizienten)
            const normCk = Math.sqrt(ck.reduce((s,v) => s+v*v, 0));
            if (normCk < tol * 1e-3) break;
        }

        const order = c.length - 1;

        // Pade-Approximant [L/M] mit L=M=padeDeg/2 fuer s=1
        // Wertet die Reihe robuster aus als direkte Summation
        const pade = (varIdx) => {
            const L = Math.min(Math.floor(padeDeg/2), Math.floor(order/2));
            const M = Math.min(padeDeg - L, order - L);
            if (L < 1 || M < 1) {
                // Fallback: direkte Summe
                return c.reduce((s, ck) => s + ck[varIdx], 0) - x0[varIdx] * (c.length - 1);
            }
            // Koeffizienten der Reihe fuer diese Variable (ab Ordnung 0)
            const a = c.map(ck => ck[varIdx]);

            // Pade via lineares System fuer Nenner-Koeffizienten q[1..M]
            // sum_{j=1}^M q[j] * a[k-j] = -a[k]  fuer k = L+1..L+M
            const Apq = [];
            const bpq = [];
            for (let k = L+1; k <= L+M && k < a.length; k++) {
                const row = [];
                for (let j = 1; j <= M; j++) row.push(k-j >= 0 ? a[k-j] : 0);
                Apq.push(row);
                bpq.push(-a[k]);
            }
            // Kleinste-Quadrate-Loesung (hier einfach: falls quadratisch, direkt loesen)
            const mSize = Apq.length;
            if (mSize === 0) return a.reduce((s,v) => s+v, 0);
            const qLU = Apq.map(r => [...r]);
            const qb  = [...bpq];
            for (let k = 0; k < mSize; k++) {
                let maxR = k;
                for (let i = k+1; i < mSize; i++)
                    if (Math.abs(qLU[i][k]) > Math.abs(qLU[maxR][k])) maxR = i;
                [qLU[k], qLU[maxR]] = [qLU[maxR], qLU[k]];
                [qb[k],  qb[maxR]]  = [qb[maxR],  qb[k]];
                if (Math.abs(qLU[k][k]) < 1e-15) continue;
                for (let i = k+1; i < mSize; i++) {
                    const f = qLU[i][k] / qLU[k][k];
                    for (let j = k; j < mSize; j++) qLU[i][j] -= f*qLU[k][j];
                    qb[i] -= f*qb[k];
                }
            }
            const q = new Array(mSize).fill(0);
            for (let i = mSize-1; i >= 0; i--) {
                q[i] = qb[i];
                for (let j = i+1; j < mSize; j++) q[i] -= qLU[i][j]*q[j];
                q[i] /= qLU[i][i] || 1;
            }
            // Zaehler p[0..L]
            const p = new Array(L+1).fill(0);
            for (let k = 0; k <= L && k < a.length; k++) {
                p[k] = a[k];
                for (let j = 1; j <= Math.min(k, mSize); j++) p[k] += (q[j-1]||0)*a[k-j];
            }
            // Auswertung bei s=1
            let num = 0, den = 1;
            for (let k = 0; k <= L; k++) num += p[k];
            for (let k = 1; k <= mSize; k++) den += (q[k-1]||0);
            if (Math.abs(den) < 1e-12) {
                // Pol nah an s=1: Fallback direkte Summe
                return a.reduce((s,v) => s+v, 0);
            }
            return num / den;
        };

        // HELM-Loesung bei s=1
        const xHelm = Array.from({length: n}, (_, i) => pade(i));

        // Residuum pruefen
        const { lo, hi } = this._buildClamp();
        const xClamped = xHelm.map((v,i) => Math.max(lo[i], Math.min(hi[i], v)));
        const Fhelm = this._residual(xClamped);
        const normHelm = Math.sqrt(Fhelm.reduce((s,v) => s+v*v, 0));

        this._log(`HELM: Ordnung=${order}, |F|=${normHelm.toFixed(2)}W`);

        const converged = normHelm < tol;

        // Wenn HELM gut genug: direkt zurueck
        // Sonst: Newton-Nachbesserung von HELM-Startpunkt
        if (converged) return { x: xClamped, converged: true, iter: order, residual: normHelm };

        // Newton-Nachbesserung (maximal 20 Iter)
        const refined = this._newton(xClamped);
        return refined;
    }

    // ── Iter-Log für AC-Knoten ────────────────────────────────────────────────

    /**
     * Überschreibt den Standard-Iter-Log aus nodeBaseSim._newton:
     * Zeigt Amplitude und Phasenwinkel statt nur |F|.
     */
    _logNewtonIter(iter, x, norm) {
        const voltLog = this._xToVoltages(x);
        const parts = [];
        for (const node of this._nodes) {
            if (node.hidden) continue;
            const v = voltLog.get(node.id);
            if (this._nodeTypes.get(node.id) === 'ac') {
                const amp = Math.sqrt(v.re**2+v.im**2);
                const phi = Math.atan2(v.im,v.re)*180/Math.PI;
                parts.push(`${node.id}: ${amp.toFixed(2)}V ∠${phi.toFixed(1)}°`);
            } else {
                parts.push(`${node.id}: ${(+v).toFixed(2)}V`);
            }
        }
        this._log(`Iter ${iter}  ${parts.join('  ')}  |F|=${norm.toFixed(4)}A`);
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
                    let pw; try { pw = block.calcCurrent(v); } catch(e) { continue; }
                    const assign = this._connectorMap.get(block) ?? {};
                    for (const [cn, nid] of Object.entries(assign)) {
                        if (nid !== node.id) continue;
                        const p = pw[cn]; if (p == null) continue;
                        const ic = this._toC(p);
                        nodeSum += ic.re;
                        console.log(`[solve] ${node.id} | ${block._label}.${cn}: I_re=${ic.re.toFixed(3)} I_im=${ic.im.toFixed(3)} A`);
                    }
                }
                console.log(`[solve] ${node.id} | Summe I=${nodeSum.toFixed(3)} A`);
            }
        }

        const appliedBlocks = new Set();
        for (const node of this._nodes) {
            for (const block of node.blocks) {
                if (appliedBlocks.has(block)) continue;
                appliedBlocks.add(block);
                const v = this._voltagesForBlock(block, voltageMap);
                try { block.applyOperatingPoint(v); }
                catch(e) { this._log('applyOperatingPoint Fehler:', e.message); }
            }
        }

        return { voltages: voltageMap, converged, iterations: iter, x: best.x };
    }
}

if (typeof window !== 'undefined') window.lastflussKomplexSim = lastflussKomplexSim;

console.log('[lastflussKomplexSim] Version 2026-06-09 build 16 (Scan-Log entfernt)');