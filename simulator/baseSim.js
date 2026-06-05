/*
baseSim.js — Abstrakte Basisklasse für alle Simulationen

Definiert das gemeinsame Interface:
  run()            — einen Berechnungsschritt ausführen (abstrakt)
  start()          — zyklische Ausführung starten
  stop()           — zyklische Ausführung stoppen
  onStep(cb)       — Callback nach jedem run(): cb(sim) => void
  onStart(cb)      — Callback wenn start() aufgerufen wird
  onStop(cb)       — Callback wenn stop() aufgerufen wird

Kopplung zwischen Sims:
  addDownstreamSim(sim)    — sim.run() wird nach jedem eigenen run() aufgerufen
  removeDownstreamSim(sim) — Kopplung entfernen

Ladereihenfolge:
  baseSim.js   ← zuerst
  signalSim.js
  lastflussSim.js
*/

class baseSim {

    constructor() {
        if (new.target === baseSim)
            throw new Error("'baseSim' kann nicht direkt instanziiert werden.");
        this._timer          = null;
        this._onStepCbs      = [];
        this._onStartCbs     = [];
        this._onStopCbs      = [];
        this._downstreamSims = [];
    }

    // ── Abstrakt ──────────────────────────────────────────────────────────────

    /**
     * Einen Berechnungsschritt ausführen.
     * Muss in der Unterklasse implementiert werden.
     * Wird von start() zyklisch und von step() manuell aufgerufen.
     */
    run() {
        throw new Error(`${this.constructor.name}.run() muss implementiert werden.`);
    }

    // ── Steuerung ─────────────────────────────────────────────────────────────

    /**
     * Zyklische Ausführung starten.
     * Unterklassen die keinen Timer brauchen (z.B. lastflussSim) können
     * start() überschreiben oder leer lassen.
     */
    start() {
        throw new Error(`${this.constructor.name}.start() muss implementiert werden.`);
    }

    /** Zyklische Ausführung stoppen. */
    stop() {
        throw new Error(`${this.constructor.name}.stop() muss implementiert werden.`);
    }

    // ── Einzelschritt ─────────────────────────────────────────────────────────

    /**
     * run() ausführen + Callbacks + Downstream-Sims.
     * Wird von start() intern aufgerufen und kann auch manuell getriggert werden.
     */
    _step() {
        this.run();
        this._downstreamSims.forEach(s => s._step());
        this._onStepCbs.forEach(cb => cb(this));
    }

    // ── Callbacks ─────────────────────────────────────────────────────────────

    /** Callback nach jedem Schritt: cb(sim) => void. Gibt this zurück (chaining). */
    onStep(cb) {
        this._onStepCbs.push(cb);
        return this;
    }

    /** Callback wenn start() aufgerufen wird: cb(sim) => void. */
    onStart(cb) {
        this._onStartCbs.push(cb);
        return this;
    }

    /** Callback wenn stop() aufgerufen wird: cb(sim) => void. */
    onStop(cb) {
        this._onStopCbs.push(cb);
        return this;
    }

    // ── Kopplung ──────────────────────────────────────────────────────────────

    /**
     * Downstream-Simulation registrieren.
     * Nach jedem eigenen run() wird sim._step() aufgerufen.
     * @param {baseSim} sim
     */
    addDownstreamSim(sim) {
        if (!(sim instanceof baseSim))
            throw new Error('addDownstreamSim: Argument muss eine baseSim-Instanz sein.');
        if (!this._downstreamSims.includes(sim))
            this._downstreamSims.push(sim);
        return this;
    }

    /** Downstream-Kopplung entfernen. */
    removeDownstreamSim(sim) {
        this._downstreamSims = this._downstreamSims.filter(s => s !== sim);
        return this;
    }
}

if (typeof window !== 'undefined') window.baseSim = baseSim;
