/*
gleichrichter.js — Dreiphasen-Brückengleichrichter (B6)
Ableitung von lastflussKomplexBlock

═══════════════════════════════════════════════════════════════════
ZWECK
═══════════════════════════════════════════════════════════════════

Modelliert nur den Gleichrichter, ohne Trafo.
Wird zusammen mit trafo.js verwendet:

  k_ac ──[trafo.js]── k_u1 ──[gleichrichter.js]── k_dc

Vorteil gegenüber trafoGleichrichter.js:
  - u1 ist ein echter Solver-Knoten (k_u1)
  - Keine blockinterne φ-Iteration nötig
  - Newton-Solver übernimmt die vollständige Konvergenz

═══════════════════════════════════════════════════════════════════
MODELL
═══════════════════════════════════════════════════════════════════

Eingangsgrössen (vom Solver):
  u1    — AC-Spannung L-L an k_u1 (komplex)
  vDc   — DC-Spannung an k_dc (reell)

Gleichrichter-Kennlinie (Dreiphasen-Brücke B6):
  vDc0  = |u1| · 1.35             Leerlauf-DC-Spannung
  i_dc  = (vDc0 - vDc) / r_int    Strom aus linearer Kennlinie
  r_int = u1Nenn · 1.35 / i_dcNenn  Innenwiderstand aus Nennpunkt
  i_dcNenn = pNom / (u1Nenn · 1.35)

Strom AC-Seite (cos φ = 1, i1 in Phase mit u1):
  i1Abs = i_dc / √3               DC→AC Stromtransformation
  i1    = i1Abs · e^(j·arg(u1))

Leistungen:
  S1    = √3 · u1 · i1*           AC-Scheinleistung (negativ = Verbrauch)
  P_dc  = max(0, -S1.re) · eta    DC-Wirkleistung (positiv = Einspeisung)

Diodenbedingung:
  i_dc = max(0, ...)   kein Rückstrom
  vDc  = max(0, vDc)   keine negative DC-Spannung

═══════════════════════════════════════════════════════════════════
VORZEICHEN-KONVENTION
═══════════════════════════════════════════════════════════════════

  S1.re  < 0  — Verbrauch an k_u1 (AC-Eingang)
  P_dc   > 0  — Einspeisung in k_dc (DC-Ausgang)
  u1: L-L-Spannung (komplex), i1: Strangstrom

Connectoren:
  in  — oben mittig   (AC-Eingang,  Knoten komplex, L-L)
  out — unten mittig  (DC-Ausgang,  Knoten reell = vDc)

Parameter:
  u1Nenn  — Nennspannung AC-Eingang L-L in V  (default: 230)
  pNom    — Nennleistung DC in W               (default: 100e3)
  eta     — Wirkungsgrad 0..1                  (default: 0.98)
*/

const GLEICHRICHTER_SVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 80">
  <rect x="4" y="4" width="52" height="72" rx="4" fill="#1a1a2e" stroke="#f0c040" stroke-width="1.5"/>
  <line x1="30" y1="4"  x2="30" y2="22" stroke="#f0c040" stroke-width="1.5"/>
  <line x1="30" y1="58" x2="30" y2="76" stroke="#f0c040" stroke-width="1.5"/>
  <line x1="11" y1="40" x2="22" y2="40" stroke="#f0c040" stroke-width="1.5"/>
  <polygon points="22,32 22,48 41,40" fill="#f0c040" stroke="#f0c040" stroke-width="1" stroke-linejoin="round"/>
  <line x1="41" y1="32" x2="41" y2="48" stroke="#f0c040" stroke-width="2"/>
  <line x1="41" y1="40" x2="47" y2="40" stroke="#f0c040" stroke-width="1.5"/>
  <text x="30" y="72" text-anchor="middle" fill="#f0c040" font-size="7" font-family="monospace">DC</text>
</svg>`);

class Gleichrichter extends lastflussKomplexBlock {

    constructor(label, { u1Nenn = 230, pNom = 100e3, eta = 0.98, x = null, y = null } = {}) {
        super({ x, y, imageW: 60, imageH: 80, imageSrc: GLEICHRICHTER_SVG });
        this._label = label;

        this.connectors = [
            { name: 'in',  x: '50%', y: '0%',   type: 'electrical', direction: 'up',   minLength: 24 },
            { name: 'out', x: '50%', y: '100%',  type: 'electrical', direction: 'down', minLength: 24 },
        ];

        this.params = [
            { key: 'u1Nenn', label: 'U1 Nenn', value: u1Nenn, format: v => `${(v/1000).toFixed(3)} kV`  },
            { key: 'pNom',   label: 'P Nenn',  value: pNom,   format: v => `${(v/1e3).toFixed(0)} kW`   },
            { key: 'eta',    label: 'η',        value: eta,    format: v => `${(v*100).toFixed(1)} %`    },
        ];
    }

    _calc(voltages) {
        const u1  = toC(voltages.in  ?? { re: this.getParam('u1Nenn'), im: 0 });
        const vDc = typeof voltages.out === 'number'
            ? voltages.out
            : (voltages.out ? cAbs(voltages.out) : this.getParam('u1Nenn') * 1.35);

        const sqrt3  = Math.sqrt(3);
        const u1Abs  = cAbs(u1);
        const vDc0   = u1Abs * 1.35;              // Leerlauf-DC-Spannung
        const vDcPos = Math.max(0, vDc);           // DC-Spannung nicht negativ

        // Innenwiderstand aus Nennpunkt:
        //   i_dcNenn = pNom / (u1Nenn · 1.35)
        //   r_int    = (u1Nenn · 1.35 - vDc_nenn) / i_dcNenn
        //   Nennarbeitspunkt: vDc_nenn ≈ u1Nenn · 1.35 · 0.997  (0.3% Spannungsabfall)
        //   Typisch für Leistungselektronik: uk_eff ≈ 0.3% (sehr steife Kennlinie)
        //   → r_int = 0.003 · (u1Nenn·1.35)² / pNom
        const vDc0Nenn = this.getParam('u1Nenn') * 1.35;
        const r_int    = 0.003 * vDc0Nenn * vDc0Nenn / this.getParam('pNom');  // 0.3% Innenwiderstand

        // DC-Strom aus linearer Gleichrichter-Kennlinie
        //   i_dc = (vDc0 - vDcPos) / r_int   (Diodenbedingung: >= 0)
        const i_dc = Math.max(0, (vDc0 - vDcPos) / r_int);

        // AC-Strangstrom: i1 in Phase mit u1 (cos φ = 1)
        const i1Abs = i_dc / sqrt3;
        const phi1  = cArg(u1);
        const i1    = { re: i1Abs * Math.cos(phi1), im: i1Abs * Math.sin(phi1) };

        // AC-Scheinleistung: S1 = √3 · u1 · i1*  (negativ = Verbrauch)
        const s1Raw  = cScale(cMul(u1, cConj(i1)), -sqrt3);

        // Diodenbedingung: keine Rückspeisung
        const pAcAbs = Math.max(0, -s1Raw.re);
        const s1     = { re: -pAcAbs, im: s1Raw.im };
        const pDc    = pAcAbs * this.getParam('eta');   // DC-Leistung

        return { u1, u1Abs, vDc, vDcPos, vDc0, i1, i_dc, s1, pDc };
    }

    calcPower(voltages) {
        const { s1, pDc } = this._calc(voltages);
        return {
            in:  s1,    // komplex → AC-Knoten
            out: pDc,   // reell   → DC-Knoten
        };
    }

    applyOperatingPoint(voltages) {
        const { u1, vDc, vDc0, i_dc, s1, pDc } = this._calc(voltages);

        this._resultFormats = {
            u1:   v => `U1: ${lastflussKomplexBlock.fmtPhasor(v)}`,
            vDc:  v => `vDc: ${v.toFixed(1)} V`,
            s1:   v => `S1: ${lastflussKomplexBlock.fmtPower({ re: -v.re, im: -v.im })}`,
            pDc:  v => `P_dc: ${(v/1e3).toFixed(2)} kW`,
            vDc0: v => `vDc0: ${v.toFixed(1)} V`,
            iDc:  v => `I_dc: ${v.toFixed(1)} A`,
            state: v => `Diode: ${v}`,
        };
        this._setResults({
            u1, vDc, s1, pDc, vDc0, iDc: i_dc,
            state: pDc <= 0 ? 'gesperrt' : 'leitend',
        });
    }
}

if (typeof window !== 'undefined') window.Gleichrichter = Gleichrichter;