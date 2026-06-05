/*
signalBlock.js — Abstrakte Zwischenklasse für regelungstechnische Blöcke
Ableitung von labeledBlock

Verantwortlichkeit:
  - tick(dt)                  — abstrakt (optional), zeitdiskrete Berechnung
  - onEvent(event)            — abstrakt (optional), eventbasierte Berechnung
  - setInput(name, value)     — Eingangswert setzen (kein Auto-Trigger)
  - _setOutputs(values)       — Ausgangswerte speichern + DOM + Downstream
  - connect(out, block, key)  — Downstream-Verbindung registrieren
  - renderOutputs()           — Ausgangswerte in sb-text2 (überschreibbar)

Ladereihenfolge:
  schematicBlock.js
  labeledBlock.js
  signalBlock.js
*/

class signalBlock extends labeledBlock {

    constructor(opts = {}) {
        super(opts);
        if (this.constructor === signalBlock) {
            throw new Error("'signalBlock' kann nicht direkt instanziiert werden.");
        }
        this.inputs       = {};   // Eingangswerte — via setInput() beschreibbar
        this.outputs      = {};   // Ausgangswerte — nur via _setOutputs() setzen
        this._connections = [];   // { outputName, targetBlock, paramKey }
        this._outputFormats = {}; // optional: { key: v => string }
    }

    // ── Connectoren (flow-Erweiterung) ───────────────────────────────────────

    /**
     * Überschreibt schematicBlock.renderConnectors().
     * Ergänzt data-flow und setzt flow-spezifische CSS-Klassen:
     *   flow 'in'  → sb-connector--signal-in  (ausgefüllter Kreis)
     *   flow 'out' → sb-connector--signal-out (hohler Ring)
     *   kein flow  → sb-connector--signal     (Fallback, rückwärtskompatibel)
     */
    renderConnectors() {
        if (!this._imageDiv) return;
        // mirroring handled by schematicBlock.renderConnectors()
        // here we only add flow-specific classes and data-flow attribute
        super.renderConnectors();
        this._imageDiv.querySelectorAll('.sb-connector').forEach(dot => {
            const name = dot.dataset.name;
            const conn = (this.connectors || []).find(c => c.name === name);
            if (!conn || !conn.flow) return;
            // replace generic signal class with flow-specific class
            dot.classList.remove('sb-connector--signal');
            dot.classList.add(`sb-connector--signal-${conn.flow}`);
            dot.dataset.flow = conn.flow;
        });
    }

    // ── Optional zu implementieren ──────────────────────────────────────────

    /** Zeitdiskrete Berechnung — wird zyklisch von signalSim aufgerufen. */
    tick(dt) {}

    /** Eventbasierte Berechnung — wird von signalSim.fireEvent() aufgerufen. */
    onEvent(event) {}

    // ── Eingang ─────────────────────────────────────────────────────────────

    /**
     * Eingangswert setzen — löst keinen Neuberechnungs-Trigger aus.
     * Berechnung erfolgt beim nächsten tick() oder onEvent().
     */
    setInput(name, value) {
        this.inputs[name] = value;
    }

    // ── Ausgang ─────────────────────────────────────────────────────────────

    /**
     * Ausgangswerte speichern, DOM aktualisieren, Downstream propagieren.
     * Wird von tick() / onEvent() der Unterklasse aufgerufen.
     * @param {object} values — z.B. { out: 3.7 }
     */
    _setOutputs(values) {
        Object.assign(this.outputs, values);
        if (this._text2Div) this.renderOutputs();
        // Downstream propagieren
        this._connections.forEach(({ outputName, targetBlock, paramKey }) => {
            if (outputName in values) {
                targetBlock.setParam(paramKey, values[outputName]);
            }
        });
        // Event feuern
        this._imageDiv?.dispatchEvent(new CustomEvent('sb-signal-output', {
            bubbles: true, detail: { block: this, outputs: { ...this.outputs } }
        }));
    }

    /**
     * Ausgangswerte in sb-text2 rendern — idempotent.
     * Kann in der Unterklasse überschrieben werden.
     */
    renderOutputs() {
        if (!this._text2Div) return;
        let container = this._text2Div.querySelector('.sb-results');
        if (!container) {
            container = document.createElement('div');
            container.className = 'sb-results';
            this._text2Div.appendChild(container);
        }
        Object.entries(this.outputs).forEach(([key, value]) => {
            let el = container.querySelector(`[data-key="${key}"]`);
            if (!el) {
                el = document.createElement('div');
                el.className   = 'sb-result';
                el.dataset.key = key;
                container.appendChild(el);
            }
            const fmt = this._outputFormats[key];
            el.textContent = fmt ? fmt(value) : `${key}: ${typeof value === 'number' ? value.toFixed(3) : value}`;
        });
        this._repositionText();
    }

    // ── Verbindungen ─────────────────────────────────────────────────────────

    /**
     * Downstream-Verbindung registrieren.
     * Bei jedem _setOutputs() wird targetBlock.setParam(paramKey, value) aufgerufen.
     * @param {string} outputName   — Schlüssel in this.outputs
     * @param {object} targetBlock  — Zielblock mit setParam()
     * @param {string} paramKey     — Schlüssel in targetBlock.params
     */
    /**
     * Downstream-Verbindung registrieren.
     * Ein Eingang (targetBlock + paramKey) darf nur eine Quelle haben — wirft sonst Error.
     * Ein Ausgang kann mehrere Ziele haben.
     */
    connect(outputName, targetBlock, paramKey) {
        // Prüfen ob der Eingang bereits belegt ist
        const existing = this._connections.find(
            c => c.targetBlock === targetBlock && c.paramKey === paramKey
        );
        if (existing) {
            throw new Error(
                `signalBlock.connect(): Eingang '${paramKey}' von '${targetBlock._label ?? targetBlock.constructor.name}' ` +
                `ist bereits mit Ausgang '${existing.outputName}' von '${existing.sourceBlock._label ?? existing.sourceBlock.constructor.name}' verbunden.`
            );
        }
        this._connections.push({ outputName, targetBlock, paramKey, sourceBlock: this });
    }
}

window.signalBlock = signalBlock;
