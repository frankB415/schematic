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

═══════════════════════════════════════════════════════════════════
TIMING
═══════════════════════════════════════════════════════════════════

opts.timing = true  aktiviert die Laufzeitmessung.
Am Ende von solve() wird eine Tabelle in die Konsole geschrieben:

  [Sim] ══ Timing ══════════════════════════
    scan          :   12.34 ms
    newton #1     :   45.67 ms
      residual    :   10.00 ms  (22%)
      jacobian    :   20.00 ms  (44%)
      solver      :    8.00 ms  (18%)
      line-search :    7.67 ms  (17%)
    applyResult   :    0.50 ms
  ─────────────────────────────────────────
    GESAMT        :   58.51 ms

Ladereihenfolge:
  baseSim.js
  nodeBaseSim.js
  lastflussSim.js
  lastflussKomplexSim.js
*/

class nodeBaseSim extends baseSim {

    /**
     * Baut das interne nodes-Array aus blocks + connections.
     * connections = [{ id, from: 'Label.connector', to: 'Label.connector', uMin, uMax, ... }]
     * blocks      = [blockInstanz, ...]
     */
    static _buildNodes(blocks, connections) {
        // Label → Block-Instanz Map
        const labelMap = new Map();
        for (const block of blocks) {
            const lbl = block._label ?? block.constructor.name;
            if (!labelMap.has(lbl)) labelMap.set(lbl, block);
        }

        // Knoten aus connections aufbauen — gleiche id → gleicher Knoten
        const nodeMap = new Map();  // id → { id, blocks: Set, uMin, uMax }
        // Explizite Connector-Zuordnung: block → { connectorName: nodeId }
        const connectorAssign = new Map();  // block → { connName: nodeId }

        for (const conn of connections) {
            const fromLabel = conn.from.slice(0, conn.from.lastIndexOf('.'));
            const fromConn  = conn.from.slice(conn.from.lastIndexOf('.') + 1);
            const toLabel   = conn.to.slice(0,   conn.to.lastIndexOf('.'));
            const toConn    = conn.to.slice(conn.to.lastIndexOf('.') + 1);
            const fromBlock = labelMap.get(fromLabel);
            const toBlock   = labelMap.get(toLabel);
            if (!fromBlock) throw new Error(`nodeBaseSim: Block mit Label "${fromLabel}" nicht gefunden.`);
            if (!toBlock)   throw new Error(`nodeBaseSim: Block mit Label "${toLabel}" nicht gefunden.`);

            if (!nodeMap.has(conn.id)) {
                nodeMap.set(conn.id, { id: conn.id, blocks: new Set(), uMin: conn.uMin, uMax: conn.uMax });
            }
            const node = nodeMap.get(conn.id);
            node.blocks.add(fromBlock);
            node.blocks.add(toBlock);
            if (conn.uMin != null) node.uMin = node.uMin != null ? Math.max(node.uMin, conn.uMin) : conn.uMin;
            if (conn.uMax != null) node.uMax = node.uMax != null ? Math.min(node.uMax, conn.uMax) : conn.uMax;

            // Connector-Zuordnung explizit speichern
            if (!connectorAssign.has(fromBlock)) connectorAssign.set(fromBlock, {});
            connectorAssign.get(fromBlock)[fromConn] = conn.id;
            if (!connectorAssign.has(toBlock)) connectorAssign.set(toBlock, {});
            connectorAssign.get(toBlock)[toConn] = conn.id;
        }

        const nodes = [...nodeMap.values()].map(n => ({ ...n, blocks: [...n.blocks] }));
        // Connector-Zuordnung an die Nodes anhängen damit _buildConnectorMap sie nutzen kann
        nodes._connectorAssign = connectorAssign;
        return nodes;
    }

    constructor(blocksOrNodes, connectionsOrOpts = {}, opts = {}) {
        super();

        // Interface-Erkennung:
        // Neu:  (blocks[], connections[], opts)  — connections hat from/to
        // Alt:  (nodes[], opts)                  — nodes hat blocks[]
        let nodes;
        if (Array.isArray(connectionsOrOpts) && connectionsOrOpts.length > 0 && 'from' in connectionsOrOpts[0]) {
            nodes = nodeBaseSim._buildNodes(blocksOrNodes, connectionsOrOpts);
            // opts bleibt opts
        } else {
            nodes = blocksOrNodes;
            opts  = connectionsOrOpts;
        }
        if (!Array.isArray(nodes) || nodes.length === 0)
            throw new Error(`${new.target.name}: nodes muss ein nicht-leeres Array sein.`);
        this._nodes     = nodes;
        this._epsilon      = opts.epsilon      ?? 0.1;   // [A] Konvergenzschwelle
        this._maxIter      = opts.maxIter      ?? 50;
        this._damp         = opts.damp         ?? 0.8;
        this._dU           = opts.dU           ?? 0.001;

        this._logging      = opts.logging      ?? false;
        this._useHelm      = opts.useHelm      ?? false;
        this._timing       = opts.timing       ?? true;

        this._x0           = opts.x0           ?? null;   // Warm-Start: Scan überspringen

        // Versteckte Knoten einsammeln bevor ConnectorMap gebaut wird
        this._collectHiddenNodes();
        this._connectorMap = this._buildConnectorMap();
    }

    _log(...args) { 
            console.log(`[${this.constructor.name}]`, ...args); 
    }

    // ── Timing ────────────────────────────────────────────────────────────────

    /** Internes Timing-Objekt zurücksetzen. */
    _timingReset() {
        this.__t = {
            total:       0,
            scan:        0,
            newton:      [],   // Array von { total, residual, jacobian, solver, linSearch }
            applyResult: 0,
        };
    }

    /** performance.now() falls verfügbar, sonst Date.now(). */
    _now() {
        return (typeof performance !== 'undefined') ? performance.now() : Date.now();
    }

    /**
     * Timing-Tabelle in die Konsole schreiben.
     * Wird am Ende von solve() aufgerufen wenn _timing aktiv.
     */
    _timingReport() {
        const t   = this.__t;
        const tag = `[${this.constructor.name}]`;
        const fmt = (ms) => ms.toFixed(3).padStart(9) + ' ms';
        const pct = (part, total) => total > 0 ? ` (${Math.round(part / total * 100)}%)` : '';
        const calls = (n) => n > 0 ? ` [${n}×]` : '';

        console.log(`${tag} ══ Timing ════════════════════════════════`);
        console.log(`${tag}   scan           : ${fmt(t.scan)}`);

        t.newton.forEach((n, i) => {
            console.log(`${tag}   newton #${i + 1}      : ${fmt(n.total)}`);
            console.log(`${tag}     residual    : ${fmt(n.residual  )}${pct(n.residual,   n.total)}`);
            console.log(`${tag}     jacobian    : ${fmt(n.jacobian  )}${pct(n.jacobian,   n.total)}`);
            console.log(`${tag}     solver      : ${fmt(n.solver    )}${pct(n.solver,     n.total)}`);
            console.log(`${tag}     line-search : ${fmt(n.linSearch )}${pct(n.linSearch,  n.total)}`);
        });

        console.log(`${tag}   applyResult    : ${fmt(t.applyResult)}`);
        console.log(`${tag} ──────────────────────────────────────────`);
        console.log(`${tag}   GESAMT         : ${fmt(t.total)}`);
    }

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

        // Explizite Zuordnung aus _buildNodes (blocks+connections Interface)
        const explicit = this._nodes._connectorAssign;
        if (explicit) {
            for (const [block, assign] of explicit) {
                map.set(block, { ...assign });
            }
        }

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
                } else if (!explicit) {
                    // Normaler Knoten, kein explizites Interface: ersten freien Connector zuweisen
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

        const Q  = [scale(b, 1 / beta)];
        const R  = [];   // R[j] = j-te Spalte der oberen Dreiecksmatrix
        const cs = [], sn = [];
        const g  = [beta];

        for (let j = 0; j < n; j++) {
            // Arnoldi: neue Krylov-Basis-Vektor
            let w = matvec(Q[j]);
            const hj = [];
            for (let i = 0; i <= j; i++) {
                hj.push(dot(w, Q[i]));
                w = sub(w, scale(Q[i], hj[i]));
            }
            const wn = norm(w);
            hj.push(wn);
            Q.push(wn > tol ? scale(w, 1 / wn) : new Array(n).fill(0));

            // Alle bisherigen Givens-Rotationen auf neue Spalte anwenden
            const rj = [...hj];
            for (let i = 0; i < j; i++) {
                const tmp  =  cs[i] * rj[i] + sn[i] * rj[i + 1];
                rj[i + 1]  = -sn[i] * rj[i] + cs[i] * rj[i + 1];
                rj[i]      = tmp;
            }

            // Neue Givens-Rotation für Subdiagonalelement (j+1, j)
            const a = rj[j], b2 = rj[j + 1] ?? 0;
            const r = Math.sqrt(a * a + b2 * b2);
            if (r < tol) { cs.push(1); sn.push(0); }
            else         { cs.push(a / r); sn.push(b2 / r); }
            rj[j]     =  cs[j] * a + sn[j] * b2;
            rj[j + 1] = 0;
            R.push(rj);

            // Rechte Seite g transformieren
            g.push(0);
            const gj = g[j];
            g[j]     =  cs[j] * gj;
            g[j + 1] = -sn[j] * gj;

            // Frühzeitiger Abbruch wenn konvergiert
            if (Math.abs(g[j + 1]) < tol) break;
        }

        // Rücksubstitution: R·y = g
        const m = R.length;
        const y = new Array(m).fill(0);
        for (let i = m - 1; i >= 0; i--) {
            let s = g[i];
            for (let k = i + 1; k < m; k++) s -= R[k][i] * y[k];
            y[i] = Math.abs(R[i][i]) > tol ? s / R[i][i] : 0;
        }

        let x = new Array(n).fill(0);
        for (let j = 0; j < m; j++) x = add(x, scale(Q[j], y[j]));
        return x;
    }

    // ── Lastfluss-Hilfsmethoden ───────────────────────────────────────────────

    /** Knoten-Belegung loggen */
    _logNodes() {
        console.log(`[${this.constructor.name}] Knoten-Belegung:`);
        for (const node of this._nodes) {
            const hidden  = node.hidden ? ' (intern)' : '';
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

    /** Summe aller Strombeitraege an einem Knoten (Einspeisung positiv) */
    _sumCurrentForNode(node, nodeVoltages) {
        let sumRe = 0, sumIm = 0;
        for (const block of node.blocks) {
            const v       = this._voltagesForBlock(block, nodeVoltages);
            const currents = block.calcCurrent(v);
            const assign  = this._connectorMap.get(block) || {};
            for (const [connName, nodeId] of Object.entries(assign)) {
                if (nodeId !== node.id) continue;
                const ic = currents[connName] ?? 0;
                if (typeof ic === 'object') { sumRe += ic.re; sumIm += ic.im; }
                else sumRe += ic;
            }
            if (typeof block.getHiddenNodes === 'function') {
                for (const hn of block.getHiddenNodes()) {
                    if (hn.id !== node.id) continue;
                    const ic = currents[hn.id] ?? currents[hn.connectorName] ?? 0;
                    if (typeof ic === 'object') { sumRe += ic.re; sumIm += ic.im; }
                    else sumRe += ic;
                }
            }
        }
        return { re: sumRe, im: sumIm };
    }

    /** Kompatibilitaets-Stub — wirft Fehler */
    _sumPowerForNode(node, nodeVoltages) {
        throw new Error('_sumPowerForNode() ist nicht mehr unterstuetzt — _sumCurrentForNode() verwenden.');
    }

    /** Obergrenze für Knotenspannung — direkt aus Connection-Range */
    _uMaxForNode(node) {
        return node.uMax ?? 1000;
    }

    /** Untergrenze für Knotenspannung — direkt aus Connection-Range */
    _uMinForNode(node) {
        return (node.uMin != null && node.uMin > 0) ? node.uMin : 1;
    }

    /** Newton-Clamp Untergrenze — identisch mit _uMinForNode */
    _uClampMin(node) { return this._uMinForNode(node); }

    /** Newton-Clamp Obergrenze — identisch mit _uMaxForNode */
    _uClampMax(node) { return this._uMaxForNode(node); }



    /** Stromfluss je Knoten (positive Einspeisung) — fuer relatives Residuum im Scan */
    _flowPerNode(nodeVoltages) {
        return this._nodes.map(node => {
            let flow = 0;
            for (const block of node.blocks) {
                const v        = this._voltagesForBlock(block, nodeVoltages);
                const currents = block.calcCurrent(v);
                const assign   = this._connectorMap.get(block) || {};
                for (const [connName, nodeId] of Object.entries(assign)) {
                    if (nodeId !== node.id) continue;
                    const ic = currents[connName] ?? 0;
                    const re = typeof ic === 'object' ? ic.re : ic;
                    if (re > 0) flow += re;
                }
            }
            return flow;
        });
    }

    // ── Abstrakte Methoden ───────────────────────────────────────────────────
    // Unterklassen müssen diese implementieren:

    /** Raster-Scan: gibt Array von Startwerten zurück */
    _scan()    { throw new Error(`${this.constructor.name}._scan() nicht implementiert`); }

    /** Residualvektor für einen Zustandsvektor x */
    _residual(x) { throw new Error(`${this.constructor.name}._residual() nicht implementiert`); }

    /** Arbeitspunkt an Blöcke übergeben */
    _applyResult(voltageMap) { throw new Error(`${this.constructor.name}._applyResult() nicht implementiert`); }

    /**
     * Dimension eines Knotens im Zustandsvektor.
     * DC: 1 (skalare Spannung), AC: 2 (re + im).
     * Unterklassen überschreiben für AC-Knoten.
     */
    _dim(nodeId) { return 1; }  // eslint-disable-line no-unused-vars

    /**
     * Clamp-Grenzen für den Zustandsvektor.
     * Gibt { lo[], hi[] } — je ein Eintrag pro Solver-Variable.
     */
    _buildClamp() {
        const lo = [], hi = [];
        for (const node of this._nodes) {
            lo.push(this._uClampMin(node));
            hi.push(this._uClampMax(node));
        }
        return { lo, hi };
    }

    /**
     * Numerische Jacobian via zentrale Differenzen.
     * dU = 1% des Prescan-Bereichs je Knoten — groß genug um Knickkennlinien
     * zu überqueren, klein genug für gute Linearisierung.
     * Gibt { J, F0 } — J[i][j] = ∂F_i/∂x_j, F0 = F(x).
     */
    _jacobian(x) {
        const F0 = this._residual(x);
        const J  = Array.from({ length: F0.length }, () => new Array(x.length).fill(0));

        // dU je Variable: 1% des Prescan-Bereichs für diesen Knoten
        // → überquert Knickkennlinien sicher, bleibt aber im linearen Regime
        let idx = 0;
        const dUs = [];
        for (const node of this._nodes) {
            const dim  = this._dim(node.id);
            const span = this._uMaxForNode(node) - this._uMinForNode(node);
            const dU = Math.max(this._dU, span * 0.01);
            for (let d = 0; d < dim; d++) dUs.push(dU);
            idx += dim;
        }

        for (let j = 0; j < x.length; j++) {
            const dU = dUs[j];
            const xp = [...x]; xp[j] += dU;
            const xm = [...x]; xm[j] -= dU;
            const Fp = this._residual(xp);
            const Fm = this._residual(xm);
            for (let i = 0; i < F0.length; i++) J[i][j] = (Fp[i] - Fm[i]) / (2 * dU);
        }
        return { J, F0 };
    }

    /**
     * Newton-Raphson mit GMRES und Line-Search.
     * Arbeitet auf dem Zustandsvektor x[] (reelle Zahlen).
     * Unterklassen überschreiben falls nötig (z.B. lastflussSim mit Koordinaten-Descent).
     * Gibt { x, converged, iter, residual } zurück.
     */
    _newton(x0) {
        const doTiming    = this._timing;
        const { lo, hi } = this._buildClamp();
        const clamp = x => x.map((v, i) => Math.max(lo[i], Math.min(hi[i], v)));
        let x = clamp([...x0]);

        const tAcc = { total: 0, residual: 0, jacobian: 0, solver: 0, linSearch: 0 };
        const tN0  = doTiming ? this._now() : 0;

        for (let iter = 0; iter < this._maxIter; iter++) {
            const tJ0       = doTiming ? this._now() : 0;
            const { J, F0 } = this._jacobian(x);
            if (doTiming) tAcc.jacobian += this._now() - tJ0;

            const tR0  = doTiming ? this._now() : 0;
            const norm = Math.sqrt(F0.reduce((s, v) => s + v*v, 0));
            if (doTiming) tAcc.residual += this._now() - tR0;

            // Iter-Log (Hook für Unterklassen mit erweitertem Format)
            if (typeof this._logNewtonIter === 'function') {
                this._logNewtonIter(iter, x, norm);
            } else {
                this._log(`Iter ${iter}  |F|=${norm.toFixed(4)}A`);
            }

            if (norm < this._epsilon) {
                // Prüfen ob Konvergenz auf Triviallösung (alle Blöcke inaktiv, F=0 trivial)
                // _flowPerNode gibt den positiven Leistungsfluss je Knoten zurück
                const voltMap = typeof this._xToVoltages === 'function'
                    ? this._xToVoltages(x)
                    : new Map(this._nodes.map((n, i) => [n.id, x[i]]));
                const flows = this._flowPerNode(voltMap);
                const totalFlow = flows.reduce((s, f) => s + f, 0);
                if (totalFlow < this._epsilon) {
                    // Triviallösung: kein Leistungsfluss — als nicht-konvergiert markieren
                    if (doTiming) { tAcc.total = this._now() - tN0; if (this.__t) this.__t.newton.push(tAcc); }
                    return { x, converged: false, iter, residual: Infinity };
                }
                if (doTiming) { tAcc.total = this._now() - tN0; if (this.__t) this.__t.newton.push(tAcc); }
                return { x, converged: true, iter, residual: norm };
            }

            // GMRES
            const tS0 = doTiming ? this._now() : 0;
            const dx  = this._gmres(J, F0.map(v => -v));
            if (doTiming) tAcc.solver += this._now() - tS0;

            // ── GMRES-Residuum: r = J·dx - (-F) ─────────────────────────────
            if (this._logging) {
                const b    = F0.map(v => -v);
                const Jdx  = J.map(row => row.reduce((s, a, j) => s + a * dx[j], 0));
                const rVec = Jdx.map((v, i) => v - b[i]);
                const rNorm = Math.sqrt(rVec.reduce((s, v) => s + v*v, 0));
                const bNorm = Math.sqrt(b.reduce((s, v) => s + v*v, 0));
                const relR  = bNorm > 0 ? rNorm / bNorm : rNorm;
                this._log(`  GMRES r=${rNorm.toExponential(2)} rel=${relR.toExponential(2)}${relR > 1e-6 ? '  !! GMRES schlecht' : ''}`);
            }

            // ── DIAGNOSE: dx vor Clipping ────────────────────────────────────
            const dxNormRaw = Math.sqrt(dx.reduce((s, v) => s + v*v, 0));
            const dxRaw     = [...dx];   // Kopie für Log nach Clipping

            // Schritt-Normierung: Richtung erhalten, Länge begrenzen
            // maxStep = 5% der mittleren Knoten-Amplitude (war 50%, zu großzügig)
            let clipped = false;
            {
                let sumAmp = 0, nNodes = 0, idxA = 0;
                for (const node of this._nodes) {
                    const dim = this._dim(node.id);
                    if (dim === 2) sumAmp += Math.sqrt(x[idxA]**2 + x[idxA+1]**2);
                    else           sumAmp += Math.abs(x[idxA]);
                    nNodes++; idxA += dim;
                }
                const avgAmp  = (sumAmp / nNodes) || 1;
                const maxStep = avgAmp * 0.05;
                if (dxNormRaw > maxStep) {
                    const s = maxStep / dxNormRaw;
                    for (let i = 0; i < dx.length; i++) dx[i] *= s;
                    clipped = true;
                }
            }

            // ── DIAGNOSE: dx per Knoten ──────────────────────────────────────
            if (this._logging) {
                const dxParts = [];
                let idxL = 0;
                for (const node of this._nodes) {
                    const dim = this._dim(node.id);
                    if (dim === 2) {
                        const amp = Math.sqrt(dx[idxL]**2 + dx[idxL+1]**2);
                        dxParts.push(`${node.id}:Δ${amp.toFixed(2)}V`);
                        idxL += 2;
                    } else {
                        dxParts.push(`${node.id}:Δ${dx[idxL].toFixed(2)}V`);
                        idxL += 1;
                    }
                }
                this._log(`  dx[${dxNormRaw.toFixed(2)}→${Math.sqrt(dx.reduce((s,v)=>s+v*v,0)).toFixed(2)}${clipped?' clip':''}] ${dxParts.join(' ')}`);
            }

            // Line-Search: backtracking mit damp=0.5, bis zu 16 Iterationen
            // damp=0.5 → α-Bereich [1.0, 3e-5], deckt auch sehr kleine Schritte
            const tL0 = doTiming ? this._now() : 0;
            const lsLog = [];
            let alpha   = 1.0;
            let accepted = false;
            const lsDamp   = 0.5;
            const lsMaxIts = 16;
            for (let ls = 0; ls < lsMaxIts; ls++) {
                const xn = clamp(x.map((v, i) => v + alpha * dx[i]));
                const moved = xn.some((v, i) => v !== x[i]);
                const nn = Math.sqrt(this._residual(xn).reduce((s, v) => s + v*v, 0));
                lsLog.push(`α=${alpha.toExponential(2)}${moved?'':'*'}|F|=${nn.toFixed(0)}`);
                if (moved && nn < norm) { x = xn; accepted = true; break; }
                alpha *= lsDamp;
            }
            if (this._logging) {
                this._log(`  LS ${accepted ? 'OK' : 'FAIL'}: ${lsLog.join(' ')}`);
            }
            if (doTiming) tAcc.linSearch += this._now() - tL0;
        }

        if (doTiming) { tAcc.total = this._now() - tN0; if (this.__t) this.__t.newton.push(tAcc); }
        const F = this._residual(x);
        return { x, converged: false, iter: this._maxIter, residual: Math.sqrt(F.reduce((s,v)=>s+v*v,0)) };
    }

    // ── Koordinaten-Descent Newton ───────────────────────────────────────────

    /**
     * Koordinaten-Descent mit Bisektion auf Nulldurchgang.
     * Für DC-Netze mit nichtlinearen Kennlinien (PV, DCDC) robuster als GMRES.
     * Arbeitet mit Map<nodeId, voltage> statt x-Vektor.
     * Gibt { nodeVoltages, converged, iter, residual } zurück.
     */
    _newtonCoordinateDescent(startVoltages) {
        const doTiming     = this._timing;
        const nodeVoltages = new Map(startVoltages);
        let converged = false, iter = 0;

        const tAcc = { total: 0, residual: 0, jacobian: 0, solver: 0, linSearch: 0 };
        const tN0  = doTiming ? this._now() : 0;

        while (iter < this._maxIter) {
            const tR0 = doTiming ? this._now() : 0;
            const F   = this._residual(nodeVoltages);
            if (doTiming) tAcc.residual += this._now() - tR0;

            const maxResidual = Math.max(...F.map(Math.abs));

            this._nodes.forEach((n, i) =>
                this._log(`Iter ${iter}  ${n.id}: U=${(nodeVoltages.get(n.id)??0).toFixed(4)}V  F=${F[i].toFixed(4)}W`)
            );

            iter++;
            if (maxResidual < this._epsilon) { converged = true; break; }

            const tL0 = doTiming ? this._now() : 0;
            for (let i = 0; i < this._nodes.length; i++) {
                const n    = this._nodes[i];
                const uMin = this._uClampMin(n);
                const uMax = this._uClampMax(n);

                try {
                    const evalF = (u) => {
                        const cand = new Map(nodeVoltages);
                        cand.set(n.id, u);
                        return this._residual(cand)[i];
                    };

                    const pts = 20;
                    let bracketLo = null, bracketHi = null;
                    let prevU = uMin, prevF = evalF(uMin);
                    let bestU = uMin, bestF = Math.abs(prevF);
                    for (let s = 1; s <= pts; s++) {
                        const u = uMin + (uMax - uMin) * s / pts;
                        const f = evalF(u);
                        if (Math.abs(f) < bestF) { bestF = Math.abs(f); bestU = u; }
                        if (bracketLo === null && prevF * f < 0) { bracketLo = prevU; bracketHi = u; }
                        prevU = u; prevF = f;
                    }

                    if (bracketLo !== null) {
                        let lo = bracketLo, hi = bracketHi;
                        let fLo = evalF(lo);
                        for (let b = 0; b < 20; b++) {
                            const mid = (lo + hi) / 2;
                            const fMid = evalF(mid);
                            if (Math.abs(fMid) < bestF) { bestF = Math.abs(fMid); bestU = mid; }
                            if (fMid === 0) break;
                            if (fLo * fMid < 0) { hi = mid; }
                            else { lo = mid; fLo = fMid; }
                        }
                    }

                    nodeVoltages.set(n.id, bestU);
                } catch(e) {
                    this._log(`Bisektion Fehler Knoten ${n.id}: ${e.message}`);
                }
            }
            if (doTiming) tAcc.linSearch += this._now() - tL0;
        }

        if (doTiming) { tAcc.total = this._now() - tN0; if (this.__t) this.__t.newton.push(tAcc); }

        const Ffinal  = this._residual(nodeVoltages);
        const allZero = [...nodeVoltages.values()].every(u => u < 1);
        if (allZero) converged = false;
        return { nodeVoltages, converged, iter, residual: allZero ? Infinity : Math.max(...Ffinal.map(Math.abs)) };
    }

    /** Reelle Solver-Variablen loggen — Unterklassen können überschreiben */
    _logSolverVars(candidates) {
        if (!candidates.length) return;
        const names = this._nodes.map(n => n.id);
        this._log(`Reelle Variablen (${names.length}): [ ${names.join(', ')} ]`);
    }

    // ── Ergebnis-Logger ───────────────────────────────────────────────────────

    /**
     * Strukturierte Ergebnisausgabe nach solve().
     * Knotenspannungen + Blockergebnisse via _resultFormats.
     * DC: number → "302.6 V"
     * AC: {re,im} → "19.8 kV ∠ -1.0°"
     * Wird in solve() nach _applyResult() aufgerufen wenn logging aktiv.
     */
    _logResults(result) {
        const { voltages, converged, iterations } = result;
        const tag = `[${this.constructor.name}]`;

        const fmtV = v => {
            if (v == null) return '?';
            if (typeof v === 'object' && 're' in v) {
                const abs = Math.sqrt(v.re ** 2 + v.im ** 2);
                const phi = Math.atan2(v.im, v.re) * 180 / Math.PI;
                const kv  = abs >= 1000;
                return `${kv ? (abs/1000).toFixed(3) + ' kV' : abs.toFixed(2) + ' V'} ∠ ${phi.toFixed(1)}°`;
            }
            const num = +v;
            return num >= 1000 ? `${(num/1000).toFixed(3)} kV` : `${num.toFixed(2)} V`;
        };

        const fmtP = p => {
            if (p == null) return '?';
            const num = +p;
            return Math.abs(num) >= 1000 ? `${(num/1000).toFixed(2)} kW` : `${num.toFixed(1)} W`;
        };

        console.log(`${tag} ${converged ? '✓' : '⚠'} Konvergenz nach ${iterations} Iterationen`);
        for (const node of this._nodes) {
            if (node.hidden) continue;
            console.log(`${tag}   ${node.id}: U = ${fmtV(voltages.get(node.id))}`);
        }

        console.log(`${tag} ── Blockergebnisse ──`);
        const seen = new Set();
        for (const node of this._nodes) {
            for (const block of node.blocks) {
                if (seen.has(block)) continue;
                seen.add(block);
                const label = block._label ?? block.constructor.name;
                console.log(`${tag}   ${label}:`);

                // Neu: renderResults-Interface — block._lastRows enthält die Zeilen
                if (block._lastRows) {
                    for (const row of block._lastRows)
                        console.log(`${tag}     ${row.text}`);
                // Alt: results + _resultFormats
                } else if (block.results) {
                    Object.entries(block.results).forEach(([key, val]) => {
                        const fmt = block._resultFormats?.[key];
                        console.log(`${tag}     ${fmt ? fmt(val) : JSON.stringify(val)}`);
                    });
                }
            }
        }
    }

    // ── solve ─────────────────────────────────────────────────────────────────

    solve() {
        const doTiming = this._timing;
        if (doTiming) this._timingReset();
        const t0 = doTiming ? this._now() : 0;

        // ── Scan ──────────────────────────────────────────────────────────────
        const tScan0 = doTiming ? this._now() : 0;
        let candidates;
        if (this._x0) {
            // Warm-Start: Scan überspringen, direkt mit übergebenem x0 starten
            candidates = [this._x0];
            this._log('Warm-Start: Scan übersprungen');
        } else {
            candidates = this._scan();
        }
        if (doTiming) this.__t.scan = this._now() - tScan0;

        // Reelle Solver-Variablen loggen
        this._logSolverVars(candidates);

        // ── HELM (optional, vor Newton) ───────────────────────────────────────
        let best = null;

        if (this._useHelm && typeof this._helm === 'function') {
            this._log('HELM-Start (bester Scan-Punkt)');
            const helmResult = this._helm(candidates[0]);
            if (helmResult.converged) {
                best = helmResult;
                this._log(`HELM konvergiert: |F|=${helmResult.residual.toFixed(2)}W`);
            } else {
                this._log(`HELM nicht konvergiert (|F|=${helmResult.residual.toFixed(2)}W), weiter mit Newton`);
                if (!best || helmResult.residual < (best?.residual ?? Infinity)) best = helmResult;
            }
        }

        // ── Newton ────────────────────────────────────────────────────────────
        if (!best?.converged) {
            for (let ci = 0; ci < candidates.length; ci++) {
                this._log(`Newton-Start #${ci + 1}`);
                const result = this._newton(candidates[ci]);
                if (result.converged) { best = result; break; }
                if (!best || result.residual < best.residual) best = result;
            }
        }

        // ── Nachlauf: besten Punkt nochmals iterieren ─────────────────────────
        if (!best.converged) {
            this._log(`Nachlauf vom besten Punkt (residual=${best.residual.toFixed(4)}W)`);
            const refined = this._newton(best.x);
            if (refined.converged || refined.residual < best.residual) best = refined;
        }

        const { converged, iter } = best;

        if (!converged) {
            this._log('Nicht konvergiert');
            this._nodes.forEach(n => n.blocks.forEach(b => b.invalidateResult?.()));
        }

        // ── applyResult ───────────────────────────────────────────────────────
        const tApply0 = doTiming ? this._now() : 0;
        const result  = this._applyResult(best, converged, iter);
        if (doTiming) this.__t.applyResult = this._now() - tApply0;

        // ── Ergebnis-Logger ───────────────────────────────────────────────────
        if (this._logging) this._logResults(result);

        // ── Timing-Report ─────────────────────────────────────────────────────
        if (doTiming) {
            this.__t.total = this._now() - t0;
            this._timingReport();
        }

        return result;
    }

    // ── baseSim Interface ─────────────────────────────────────────────────────

    run()   { this.solve(); }
    start() {}
    stop()  {}
}

if (typeof window !== 'undefined') window.nodeBaseSim = nodeBaseSim;

console.log('[nodeBaseSim] Version 2026-06-09 build 17 (Triviallösung prüfen)');