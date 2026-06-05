/*
lastflussKomplexBlock.js — Abstrakte Basisklasse für Wechselstrom-Lastfluss-Blöcke
Ableitung von lastflussBlock

═══════════════════════════════════════════════════════════════════
EINLEITERSPEMA / SINGLE-LINE-DARSTELLUNG
═══════════════════════════════════════════════════════════════════

Alle Blöcke dieses Frameworks arbeiten mit dem Einleiterschema
(Single-Line Diagram) eines symmetrischen Dreiphasensystems:

  - Spannungen u sind verkettete Leiterspannungen (L-L) in Volt
    Beispiel: u = 400 V entspricht dem 400V-Netz (U_L-L)
  - Ströme i sind Strangströme einer Phase
  - Impedanzen z sind Strang-Impedanzen (Einphasen-Ersatzschaltbild)
  - Leistungen P, Q, S sind Dreiphasen-Gesamtleistungen
    Formel: S = √3 · U_LL · I_Strang · e^(jφ)

Der Faktor √3 erscheint deshalb in allen Leistungsformeln:
  p = √3 · u · i*   (nicht u · i*)

Konsequenz für die Impedanz:
  Bei gegebener Nennspannung U_LL und Nennleistung S_3ph gilt:
  Z_Strang = U_LL² / S_3ph   (nicht U_LL² / (3·S_3ph))
  weil U_LL = √3 · U_Strang bereits im √3-Faktor steckt.

═══════════════════════════════════════════════════════════════════
SCHNITTSTELLE
═══════════════════════════════════════════════════════════════════

Unterschied zu lastflussBlock:
  - calcPower(voltages) arbeitet mit komplexen Spannungen { re, im }
  - Rückgabe: { connectorName: { re, im } }  (Scheinleistung in VA)
  - Vorzeichen: re>0 = Einspeisung, re<0 = Verbrauch
                im<0 = induktiv,    im>0 = kapazitiv

Komplexe Hilfsfunktionen als Modulvariablen verfügbar für alle Blöcke:
  cAdd, cSub, cMul, cDiv, cConj, cAbs, cArg, cScale, toC  (aus dieser Datei)
  interpTable                                               (aus lastflussBlock.js)

  Hinweis: Der Simulator (lastflussKomplexSim.js) ist bewusst unabhängig
  und hat eigene private Kopien dieser Funktionen (_toC, _cAbs, ...).
  Duplikate sind hier akzeptiert um die Kopplung zu vermeiden.

Ladereihenfolge:
  schematicBlock.js
  labeledBlock.js
  lastflussBlock.js
  lastflussKomplexBlock.js
*/

// ── Komplexe Arithmetik (Modulebene) ─────────────────────────────────────────

const cAdd   = (a, b) => ({ re: a.re + b.re, im: a.im + b.im });
const cSub   = (a, b) => ({ re: a.re - b.re, im: a.im - b.im });
const cMul   = (a, b) => ({ re: a.re*b.re - a.im*b.im, im: a.re*b.im + a.im*b.re });
const cConj  = (a)    => ({ re: a.re, im: -a.im });
const cAbs   = (a)    => Math.sqrt(a.re**2 + a.im**2);
const cArg   = (a)    => Math.atan2(a.im, a.re);
const cScale = (a, s) => ({ re: a.re * s, im: a.im * s });
const cDiv   = (a, b) => {
    const d = b.re**2 + b.im**2;
    if (d === 0) return { re: 0, im: 0 };
    return { re: (a.re*b.re + a.im*b.im) / d,
             im: (a.im*b.re - a.re*b.im) / d };
};
const toC    = (v)    => typeof v === 'number' ? { re: v, im: 0 } : v;

// ─────────────────────────────────────────────────────────────────────────────

class lastflussKomplexBlock extends lastflussBlock {

    constructor(opts = {}) {
        super(opts);
        if (this.constructor === lastflussKomplexBlock)
            throw new Error("'lastflussKomplexBlock' kann nicht direkt instanziiert werden.");
    }

    // ── Abstrakt ──────────────────────────────────────────────────────────────

    /**
     * Leistungsbeitrag bei gegebenen komplexen Knotenspannungen.
     * @param {{ connectorName: {re, im} }} voltages — Phasoren in V (L-L)
     * @returns {{ connectorName: {re, im} }}         — Scheinleistung in VA
     */
    calcPower(voltages) {
        throw new Error(`${this.constructor.name}.calcPower() muss implementiert werden.`);
    }

    // ── Hilfsfunktionen ───────────────────────────────────────────────────────

    /** Komplexe Addition */
    static cAdd   = cAdd;
    static cSub   = cSub;
    static cMul   = cMul;
    static cConj  = cConj;
    static cAbs   = cAbs;
    static cArg   = cArg;
    static cScale = cScale;
    static cDiv   = cDiv;
    static toC    = toC;

    /** Formatiert einen Phasor als "|U| kV ∠ φ°" */
    static fmtPhasor(v, digits = 3) {
        const abs = cAbs(v) / 1000;
        const phi = cArg(v) * 180 / Math.PI;
        return `${abs.toFixed(digits)} kV ∠ ${phi.toFixed(1)}°`;
    }

    /** Formatiert Scheinleistung als "( -49.4 kW - j1.0 ) kVA" */
    static fmtPower(s, digits = 1) {
        const p    = s.re / 1000;
        const q    = s.im / 1000;
        const sign = q >= 0 ? '+' : '-';
        return `( ${p.toFixed(digits)} ${sign} j${Math.abs(q).toFixed(digits)} ) kVA`;
    }


}

if (typeof window !== 'undefined') {
    window.lastflussKomplexBlock = lastflussKomplexBlock;
    window.cAdd   = cAdd;
    window.cSub   = cSub;
    window.cMul   = cMul;
    window.cConj  = cConj;
    window.cAbs   = cAbs;
    window.cArg   = cArg;
    window.cScale = cScale;
    window.cDiv   = cDiv;
    window.toC    = toC;
}