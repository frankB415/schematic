/*
lastflussBlock.js — Abstrakte Zwischenklasse für Lastfluss-Blöcke
Ableitung von labeledBlock

Einbindung via <script src="blocks/lastflussBlock.js"> → window.lastflussBlock

Verantwortlichkeit:
  - calcPower(voltages)         — abstrakt, Leistungsbeitrag je Connector
  - applyOperatingPoint(voltages) — abstrakt, Arbeitspunkt nach Konvergenz
  - _setResults(values)         — Istwerte in this.results + renderResults()
  - renderResults()             — Istwerte in sb-text2 (überschreibbar)
  - invalidateResult()          — Ergebnis als ungültig markieren

Ladereihenfolge:
  /schematic/schematicBlock/schematicBlock.js
  /schematic/labeledBlock/labeledBlock.js
  /schematic/lastflussBlock/lastflussBlock.js

Hinweis: calcPower() wird während der Bisektion oft aufgerufen → kein Seiteneffekt.
         applyOperatingPoint() wird einmalig nach Konvergenz aufgerufen.
*/

class lastflussBlock extends labeledBlock {

    constructor(opts = {}) {
        super(opts);
        if (this.constructor === lastflussBlock) {
            throw new Error("'lastflussBlock' kann nicht direkt instanziiert werden.");
        }
        this.results = {};   // berechnete Istwerte — nur via _setResults() setzen
    }

    // ── Abstrakt ────────────────────────────────────────────────────────────

    /**
     * Leistungsbeitrag bei gegebenen Knotenspannungen.
     * Kein Seiteneffekt — wird während der Bisektion oft aufgerufen.
     * @param {{ connectorName: voltage }} voltages
     * @returns {{ connectorName: power }} — positiv = Einspeisung, negativ = Verbrauch
     */
    calcPower(voltages) {
        throw new Error(`${this.constructor.name}.calcPower() muss implementiert werden.`);
    }

    /**
     * Arbeitspunkt übernehmen — einmalig nach Konvergenz durch lastflussSim aufgerufen.
     * Soll _setResults() aufrufen um Istwerte zu speichern und anzuzeigen.
     * @param {{ connectorName: voltage }} voltages
     */
    applyOperatingPoint(voltages) {
        throw new Error(`${this.constructor.name}.applyOperatingPoint() muss implementiert werden.`);
    }

    // ── Ergebnis-Verwaltung ─────────────────────────────────────────────────

    /**
     * Istwerte speichern und DOM aktualisieren.
     * Wird von applyOperatingPoint() der Unterklasse aufgerufen.
     * @param {object} values — z.B. { pAct: 287.3, uAct: 33.15 }
     */
    _setResults(values) {
        Object.assign(this.results, values, { valid: true });
        if (this._text2Div) this.renderResults();
    }

    /**
     * Ergebnis als ungültig markieren — z.B. wenn lastflussSim nicht konvergiert.
     */
    invalidateResult() {
        this.results.valid = false;
        if (this._text2Div) this.renderResults();
    }

    /**
     * Istwerte in sb-text2 rendern — idempotent.
     * Default: einspaltig, alle Werte untereinander.
     * Kann in der Unterklasse überschrieben werden.
     */
    renderResults() {
        if (!this._text2Div) return;
        let container = this._text2Div.querySelector('.sb-results');
        if (!container) {
            container = document.createElement('div');
            container.className = 'sb-results';
            this._text2Div.appendChild(container);
        }
        container.innerHTML = '';
        for (const [key, value] of Object.entries(this.results)) {
            if (key === 'valid') continue;
            const row = document.createElement('div');
            row.className   = 'sb-result';
            row.dataset.key = key;
            const fmt = this._resultFormats?.[key];
            row.textContent = fmt ? fmt(value) : `${key}: ${value ?? '—'}`;
            container.appendChild(row);
        }
        container.classList.toggle('sb-results--invalid', this.results.valid === false);
        this._repositionText();
    }
    // ── Formatter ────────────────────────────────────────────────────────────

    /** Formatiert Wirkleistung als "49.09 kW" */
    static fmtKW(v, digits = 2) {
        return `${(Math.abs(v) / 1000).toFixed(digits)} kW`;
    }

    /** Formatiert Spannung als "0.228 kV" */
    static fmtKV(v, digits = 3) {
        return `${(v / 1000).toFixed(digits)} kV`;
    }

    /** Formatiert Strom als "124.4 A" */
    static fmtA(v, digits = 1) {
        return `${v.toFixed(digits)} A`;
    }
}

if (typeof window !== 'undefined') window.lastflussBlock = lastflussBlock;


// ── interpTable — lineare Interpolation über Stützpunkte ─────────────────────
//
// Interpoliert einen y-Wert zu einem gegebenen x anhand einer Tabelle aus
// Stützpunkten. Die Tabelle muss nach x aufsteigend sortiert sein.
//
// Verhalten außerhalb des definierten Bereichs:
//   x < table[0].x     →  table[0].y      (letzter linker Wert, kein Extrapolieren)
//   x > table[last].x  →  table[last].y   (letzter rechter Wert)
//
// Parameter:
//   table   Array von { x, y } — Stützpunkte, aufsteigend nach x sortiert
//   x       gesuchter x-Wert
//
// Rückgabe: interpolierter y-Wert (number)
//
// Beispiel — MPPT-Kennlinie mit weichem Ein-/Ausschalten:
//
//   const mpptCurve = [
//       { x: 19,  y:   0 },   // unter uMin-5%: inaktiv
//       { x: 20,  y: 300 },   // uMin: voll aktiv (linearer Anstieg 19→20V)
//       { x: 40,  y: 300 },   // uMax: voll aktiv (Plateau)
//       { x: 41,  y:   0 },   // über uMax+5%: abgeregelt (linearer Abfall 40→41V)
//   ];
//
//   interpTable(mpptCurve, 19.5)  // →  150  (Mitte des Anstiegs)
//   interpTable(mpptCurve, 30)    // →  300  (Plateau)
//   interpTable(mpptCurve, 40.5)  // →  150  (Mitte des Abfalls)
//   interpTable(mpptCurve, 10)    // →    0  (außerhalb links → erster Wert)
//   interpTable(mpptCurve, 50)    // →    0  (außerhalb rechts → letzter Wert)
//
// Weitere Anwendung — beliebige nichtlineare Kennlinie (z.B. Batterie-SoC):
//
//   const ocvCurve = [
//       { x: 0.0, y: 48.0 },   // SoC 0% → 48V
//       { x: 0.5, y: 51.2 },   // SoC 50% → 51.2V
//       { x: 1.0, y: 54.6 },   // SoC 100% → 54.6V
//   ];
//   const uOcv = interpTable(ocvCurve, soc);   // Leerlaufspannung bei gegebenem SoC
//
function interpTable(table, x) {
    if (x <= table[0].x)                  return table[0].y;
    if (x >= table[table.length - 1].x)   return table[table.length - 1].y;
    for (let i = 1; i < table.length; i++) {
        if (x <= table[i].x) {
            const t = (x - table[i-1].x) / (table[i].x - table[i-1].x);
            return table[i-1].y + t * (table[i].y - table[i-1].y);
        }
    }
    return table[table.length - 1].y;
}

if (typeof window !== 'undefined') window.interpTable = interpTable;