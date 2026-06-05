/*
signalSim.js — Zeitdiskrete Simulation für signalBlock-Instanzen
Erbt von baseSim.

run()  = einen Zeitschritt ausführen (alle tick(dt) + fireEvent-Queue)
start() = zyklischer Timer mit dt

Kopplung mit anderen Sims (z.B. lastflussSim) über baseSim.addDownstreamSim():
  sigSim.addDownstreamSim(lastSim);
  // → nach jedem Tick: lastSim._step() → lastSim.run() → solve()

Ladereihenfolge:
  baseSim.js
  signalSim.js
*/

class signalSim extends baseSim {

    /**
     * @param {signalBlock[]} blocks
     * @param {object}        [opts]
     * @param {number}        [opts.dt=0.1]          — Zeitschritt in Sekunden
     * @param {boolean}       [opts.autoStart=false]
     * @param {boolean}       [opts.logging=false]
     */
    constructor(blocks, opts = {}) {
        super();
        this._blocks  = blocks;
        this._dt      = opts.dt      ?? 0.1;
        this._logging = opts.logging ?? false;
        this._t       = 0;

        if (opts.autoStart) this.start();
    }

    // ── baseSim Interface ─────────────────────────────────────────────────────

    /** Einen Zeitschritt ausführen: alle tick(dt) auf allen Blöcken. */
    run() {
        this._t += this._dt;
        if (this._logging) console.log(`[signalSim] tick t=${this._t.toFixed(3)}s`);
        this._blocks.forEach(b => b.tick(this._dt));
    }

    /** Zyklische Ausführung starten. */
    start() {
        if (this._timer) return;
        this._timer = setInterval(() => this._step(), this._dt * 1000);
        this._onStartCbs.forEach(cb => cb(this));
        if (this._logging) console.log(`[signalSim] start — dt=${this._dt}s`);
    }

    /** Zyklische Ausführung stoppen. */
    stop() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
        this._onStopCbs.forEach(cb => cb(this));
        if (this._logging) console.log(`[signalSim] stop — t=${this._t.toFixed(3)}s`);
    }

    // ── Zeitschritt ───────────────────────────────────────────────────────────

    /** Zeitschritt zur Laufzeit ändern. */
    setDt(dt) {
        this._dt = dt;
        if (this._timer) { this.stop(); this.start(); }
    }

    /** Simulationszeit zurücksetzen. */
    reset() {
        this.stop();
        this._t = 0;
        this._blocks.forEach(b => { b.inputs = {}; b.outputs = {}; });
    }

    /** Aktuelle Simulationszeit in Sekunden. */
    get t() { return this._t; }

    // ── Events ────────────────────────────────────────────────────────────────

    /**
     * Event an alle Blöcke senden (onEvent) + danach _step() für Downstream.
     * @param {{ type: string, source?: object, data?: any }} event
     */
    fireEvent(event) {
        if (this._logging) console.log(`[signalSim] fireEvent type=${event.type}`);
        this._blocks.forEach(b => b.onEvent(event));
        // Downstream-Sims sofort aktualisieren (Ereignis = schlagartiger Zustandswechsel)
        this._downstreamSims.forEach(s => s._step());
    }
}

if (typeof window !== 'undefined') window.signalSim = signalSim;
