/*
lastflussBlock.js — Abstrakte Zwischenklasse für Lastfluss-Blöcke
Ableitung von labeledBlock

Einbindung via <script src="blocks/lastflussBlock.js"> → window.lastflussBlock

Verantwortlichkeit:
  - calcCurrent(voltages)         — abstrakt, Strombeitrag je Connector [A]
  - applyOperatingPoint(voltages) — abstrakt, Arbeitspunkt nach Konvergenz
  - renderResults(rows)           — fertig formatierte Zeilen anzeigen
  - invalidateResult()            — Ergebnis als ungültig markieren

API für Unterklassen:
  applyOperatingPoint(voltages) {
      // ...berechnen...
      this.renderResults([
          { key: 'pOut', text: `pOut: ${pOut.toFixed(1)} W` },
          { key: 'uOut', text: `uOut: ${uOut.toFixed(2)} V` },
      ]);
  }

Ladereihenfolge:
  /schematic/schematicBlock/schematicBlock.js
  /schematic/labeledBlock/labeledBlock.js
  /schematic/lastflussBlock/lastflussBlock.js

Hinweis: calcCurrent() wird waehrend der Iteration oft aufgerufen → kein Seiteneffekt.
         applyOperatingPoint() wird einmalig nach Konvergenz aufgerufen.
*/

class lastflussBlock extends labeledBlock {

    constructor(opts = {}) {
        super(opts);
        if (this.constructor === lastflussBlock) {
            throw new Error("'lastflussBlock' kann nicht direkt instanziiert werden.");
        }
        this._resultsValid = false;
    }

    // ── Abstrakt ────────────────────────────────────────────────────────────

    /**
     * Strombeitrag bei gegebenen Knotenspannungen.
     * Positiv = Einspeisung in Knoten, negativ = Entnahme.
     * DC: reelle Zahl [A]. AC: {re, im} [A] (Strangstrom).
     * Kein Seiteneffekt — wird waehrend der Iteration oft aufgerufen.
     * @param {{ connectorName: voltage }} voltages
     * @returns {{ connectorName: current }}
     */
    calcCurrent(voltages) {
        throw new Error(`${this.constructor.name}.calcCurrent() muss implementiert werden.`);
    }

    /**
     * calcPower() wurde durch calcCurrent() ersetzt.
     * Dieser Aufruf wirft immer einen Fehler.
     */
    calcPower(voltages) {
        throw new Error(`${this.constructor.name}.calcPower() ist nicht mehr unterstuetzt — calcCurrent() verwenden.`);
    }

    /**
     * Arbeitspunkt übernehmen — einmalig nach Konvergenz durch lastflussSim aufgerufen.
     * Soll renderResults(rows) aufrufen.
     * @param {{ connectorName: voltage }} voltages
     */
    applyOperatingPoint(voltages) {
        throw new Error(`${this.constructor.name}.applyOperatingPoint() muss implementiert werden.`);
    }

    // ── Ergebnis-Anzeige ────────────────────────────────────────────────────

    /**
     * Fertig formatierte Zeilen in sb-text2 rendern.
     * @param {{ key: string, text: string }[]} rows
     */
    renderResults(rows) {
        this._lastRows = rows;   // für _logResults in nodeBaseSim
        this._resultsValid = true;
        if (!this._text2Div) return;
        let container = this._text2Div.querySelector('.sb-results');
        if (!container) {
            container = document.createElement('div');
            container.className = 'sb-results';
            this._text2Div.appendChild(container);
        }
        container.innerHTML = '';
        for (const { key, text } of rows) {
            const row = document.createElement('div');
            row.className    = 'sb-result';
            row.dataset.key  = key;
            row.textContent  = text;
            container.appendChild(row);
        }
        container.classList.remove('sb-results--invalid');
        this._repositionText();
    }

    /**
     * Ergebnis als ungültig markieren — z.B. wenn lastflussSim nicht konvergiert.
     */
    invalidateResult() {
        this._resultsValid = false;
        if (!this._text2Div) return;
        const container = this._text2Div.querySelector('.sb-results');
        if (container) container.classList.add('sb-results--invalid');
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


// ── interpTable ───────────────────────────────────────────────────────────────
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