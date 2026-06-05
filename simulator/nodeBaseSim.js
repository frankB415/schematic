/*
nodeBaseSim.js — Abstrakte Basisklasse für knotenbasierte Simulatoren
Erbt von baseSim.

═══════════════════════════════════════════════════════════════════
ZWECK
═══════════════════════════════════════════════════════════════════

Stellt das Knoten-Konzept für alle Lastfluss-Simulatoren bereit:
  - Knoten-Verwaltung (_nodes, _connectorMap)
  - Versteckte Knoten (_collectHiddenNodes)
  - Connector-Zuordnung (_buildConnectorMap, _voltagesForBlock)
  - GMRES-Löser (gemeinsam für alle Unterklassen)
  - run() / start() / stop() Interface

Das Lösungsverfahren (Scan, Newton, Residual) ist abstrakt —
jede Unterklasse implementiert es für ihren Knotentyp.

═══════════════════════════════════════════════════════════════════
KLASSENHIERARCHIE
═══════════════════════════════════════════════════════════════════

  baseSim
    ├── signalSim          — Signalpfad, kein Knoten-Konzept
    └── nodeBaseSim        — Knoten-Konzept (diese Klasse)
          ├── lastflussSim        — DC-Lastfluss (reell)
          │     └── lastflussKomplexSim  — AC/DC-Lastfluss (komplex)
          └── zukünftige Simulatoren...

═══════════════════════════════════════════════════════════════════
VERSTECKTE KNOTEN
═══════════════════════════════════════════════════════════════════

Blöcke können optional getHiddenNodes() implementieren:

  getHiddenNodes() {
      return [{
          id:     this._uid + '.u2',   // eindeutig durch Block-UID
          blocks: [this],
          uMin:   100,
          uMax:   300,
      }];
  }

Der Simulator legt diese Knoten automatisch an — der Benutzer
deklariert sie nicht in der Demo.

Ladereihenfolge:
  baseSim.js
  nodeBaseSim.js
  lastflussSim.js
  lastflussKomplexSim.js
*/

class nodeBaseSim extends baseSim {

    constructor(nodes, opts = {}) {
        super();
        if (!Array.isArray(nodes) || nodes.length === 0)
            throw new Error(`${new.target.name}: nodes muss ein nicht-leeres Array sein.`);
        this._nodes     = nodes;
        this._epsilon   = opts.epsilon   ?? 10;
        this._maxIter   = opts.maxIter   ?? 50;
        this._damp      = opts.damp      ?? 0.8;
        this._dU        = opts.dU        ?? 0.001;
        this._scanSteps = opts.scanSteps ?? 20;
        this._scanTop   = opts.scanTop   ?? 10;
        this._logging   = opts.logging   ?? false;

        // Versteckte Knoten einsammeln bevor ConnectorMap gebaut wird
        this._collectHiddenNodes();
        this._connectorMap = this._buildConnectorMap();
    }

    _log(...args) { if (this._logging) console.log(`[${this.constructor.name}]`, ...args); }

    // ── Versteckte Knoten ─────────────────────────────────────────────────────

    /**
     * Blöcke nach getHiddenNodes() befragen und fehlende Knoten in _nodes eintragen.
     * Wird vor _buildConnectorMap() aufgerufen.
     * Versteckte Knoten tragen hidden:true — im Log als (intern) markiert.
     */
    _collectHiddenNodes() {
        const allBlocks = new Set(this._nodes.flatMap(n => n.blocks));
        for (const block of allBlocks) {
            if (typeof block.getHiddenNodes !== 'function') continue;
            for (const hn of block.getHiddenNodes()) {
                // Duplikat-Prüfung: gleiche ID von zwei verschiedenen Blöcken → Error
                const existing = this._nodes.find(n => n.id === hn.id);
                if (existing) {
                    if (existing.hidden) {
                        // Zwei Blöcke melden denselben versteckten Knoten — Label nicht eindeutig
                        throw new Error(
                            `nodeBaseSim: versteckter Knoten "${hn.id}" wird von mehreren Blöcken gemeldet. ` +
                            `Block-Labels müssen eindeutig sein.`
                        );
                    }
                    continue;   // Knoten bereits als normaler Knoten deklariert — ok
                }
                this._nodes.push({
                    id:     hn.id,
                    blocks: hn.blocks,
                    uMin:   hn.uMin ?? 0,
                    uMax:   hn.uMax ?? 1e6,
                    hidden: true,
                });
            }
        }
    }

    // ── Connector-Map ─────────────────────────────────────────────────────────

    /**
     * Baut die Zuordnung Block → { connectorName: nodeId }.
     * Für jeden Block und jeden Knoten wird der erste noch nicht belegte
     * Connector dem Knoten zugewiesen.
     */
    _buildConnectorMap() {
        const map = new Map();
        for (const node of this._nodes) {
            for (const block of node.blocks) {
                if (!map.has(block)) map.set(block, {});
                const assign = map.get(block);

                if (node.hidden) {
                    // Versteckter Knoten: connectorName explizit vom Block holen
                    if (typeof block.getHiddenNodes === 'function') {
                        for (const hn of block.getHiddenNodes()) {
                            if (hn.id === node.id && hn.connectorName) {
                                assign[hn.connectorName] = node.id;
                            }
                        }
                    }
                } else {
                    // Normaler Knoten: ersten freien Connector zuweisen
                    const conns = block.getConnectors ? block.getConnectors() : [];
                    for (const conn of conns) {
                        if (!(conn.name in assign)) {
                            assign[conn.name] = node.id;
                            break;
                        }
                    }
                }
            }
        }
        return map;
    }

    /**
     * Liefert das voltages-Objekt für einen Block:
     * { connectorName: spannung, ... }
     * Versteckte Knoten werden zusätzlich via hiddenId-Key übergeben.
     * Unterklassen überschreiben diese Methode um den Spannungstyp anzupassen.
     */
    _voltagesForBlock(block, voltageMap) {
        const assign = this._connectorMap.get(block) ?? {};
        const v = {};
        for (const [connName, nodeId] of Object.entries(assign)) {
            v[connName] = voltageMap.get(nodeId) ?? 0;
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

    // ── GMRES ────────────────────────────────────────────────────────────────
    //
    // Löst J·x = b auch bei schlecht konditionierter Jacobi.
    // Minimiert ||J·x - b|| im Krylov-Unterraum.
    // Wird von lastflussSim verwendet; lastflussKomplexSim nutzt Gauß-Elimination.

    _gmres(J, b) {
        const n      = b.length;
        const tol    = 1e-10;
        const matvec = v => J.map(row => row.reduce((s, a, j) => s + a * v[j], 0));
        const dot    = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
        const norm   = a => Math.sqrt(dot(a, a));
        const add    = (a, b) => a.map((x, i) => x + b[i]);
        const scale  = (a, s) => a.map(x => x * s);
        const sub    = (a, b) => a.map((x, i) => x - b[i]);

        const beta = norm(b);
        if (beta < tol) return new Array(n).fill(0);

        const Q = [scale(b, 1 / beta)];
        const H = [];

        for (let j = 0; j < n; j++) {
            let w = matvec(Q[j]);
            const hj = [];
            for (let i = 0; i <= j; i++) {
                hj.push(dot(w, Q[i]));
                w = sub(w, scale(Q[i], hj[i]));
            }
            const wn = norm(w);
            hj.push(wn);
            H.push(hj);
            Q.push(wn > tol ? scale(w, 1 / wn) : new Array(n).fill(0));
        }

        const m  = H.length;
        const g  = new Array(m + 1).fill(0); g[0] = beta;
        const cs = [], sn = [];
        const Hd = H.map(col => col.slice());

        for (let j = 0; j < m; j++) {
            const a = Hd[j][j], b2 = Hd[j][j + 1] ?? 0;
            const r = Math.sqrt(a * a + b2 * b2);
            if (r < tol) { cs.push(1); sn.push(0); continue; }
            cs.push(a / r); sn.push(b2 / r);
            Hd[j][j] = r; Hd[j][j + 1] = 0;
            const gj = g[j], gj1 = g[j + 1] ?? 0;
            g[j]     =  cs[j] * gj + sn[j] * gj1;
            g[j + 1] = -sn[j] * gj + cs[j] * gj1;
        }

        const y = new Array(m).fill(0);
        for (let i = m - 1; i >= 0; i--) {
            let s = g[i];
            for (let k = i + 1; k < m; k++) s -= (Hd[k][i] ?? 0) * y[k];
            y[i] = Math.abs(Hd[i][i]) > tol ? s / Hd[i][i] : 0;
        }

        let x = new Array(n).fill(0);
        for (let j = 0; j < m; j++) x = add(x, scale(Q[j], y[j]));
        return x;
    }

    // ── Abstrakte Methoden ───────────────────────────────────────────────────
    // Unterklassen müssen diese implementieren:

    /** Raster-Scan: gibt Array von Startwerten zurück */
    _scan()    { throw new Error(`${this.constructor.name}._scan() nicht implementiert`); }

    /** Residualvektor für einen Zustandsvektor x */
    _residual(x) { throw new Error(`${this.constructor.name}._residual() nicht implementiert`); }

    /** Newton-Raphson für einen Startwert, gibt { x, converged, iter, residual } */
    _newton(x0) { throw new Error(`${this.constructor.name}._newton() nicht implementiert`); }

    /** Arbeitspunkt an Blöcke übergeben */
    _applyResult(voltageMap) { throw new Error(`${this.constructor.name}._applyResult() nicht implementiert`); }

    /** Reelle Solver-Variablen loggen — Unterklassen können überschreiben */
    _logSolverVars(candidates) {
        if (!candidates.length) return;
        // Default: Knoten-IDs (DC-Simulator)
        const names = this._nodes.map(n => n.id);
        this._log(`Reelle Variablen (${names.length}): [ ${names.join(', ')} ]`);
    }

    // ── solve ─────────────────────────────────────────────────────────────────

    solve() {
        const candidates = this._scan();

        // Reelle Solver-Variablen loggen — ab hier ist es eine DC-Simulation
        // Unterklassen können _logSolverVars() überschreiben für spezifischere Ausgabe
        if (this._logging) this._logSolverVars(candidates);

        let best = null;

        for (let ci = 0; ci < candidates.length; ci++) {
            this._log(`Newton-Start #${ci + 1}`);
            const result = this._newton(candidates[ci]);
            if (result.converged) { best = result; break; }
            if (!best || result.residual < best.residual) best = result;
        }

        const { converged, iter } = best;

        if (!converged) {
            this._log('Nicht konvergiert');
            this._nodes.forEach(n => n.blocks.forEach(b => b.invalidateResult?.()));
        }

        return this._applyResult(best, converged, iter);
    }

    // ── baseSim Interface ─────────────────────────────────────────────────────

    run()   { this.solve(); }
    start() {}
    stop()  {}
}

if (typeof window !== 'undefined') window.nodeBaseSim = nodeBaseSim;