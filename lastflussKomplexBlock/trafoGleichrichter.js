/*
trafoGleichrichter.js — Transformator + Gleichrichter (Dioden-Brücke)
Ableitung von lastflussKomplexBlock

═══════════════════════════════════════════════════════════════════
MODELL-ÜBERSICHT
═══════════════════════════════════════════════════════════════════

Topologie:
  k1 (AC, komplex) ──[Trafo]──[Gleichrichter]── k_dc (DC, reell)

Der Block meldet dem Simulator einen versteckten Knoten k_u2 (AC, 230V-Seite).
Der Simulator legt diesen Knoten automatisch an — der Benutzer deklariert
ihn nicht explizit in der Demo.

  k1 ──[Trafo-Teil]── k_u2 (intern) ──[Gleichrichter-Teil]── k_dc

Vorteil gegenüber blockinterner φ-Iteration:
  - u2 ist ein echter Solver-Knoten
  - Keine blockinterne φ-Iteration nötig
  - Newton-Solver übernimmt die vollständige Konvergenz
  - Saubere Jacobian-Matrix

═══════════════════════════════════════════════════════════════════
TRAFO-TEIL (Connector 'in' → versteckter Knoten k_u2)
═══════════════════════════════════════════════════════════════════

  ue      = u1Nenn / u2Nenn
  zTrafo  = (u2Nenn² / sNenn) · ((1-eta) + j·uk)   [Strang-Impedanz]
  u2LL    = u1 / ue                                  [Leerlauf-Sekundärspannung]
  i2      = (u1/ue - u2) / (√3 · zTrafo)
  i1      = i2 / ue
  p1      = -√3 · u1 · i1*                           [Verbrauch k1]
  p_u2    = +√3 · u2 · i2*                           [Einspeisung k_u2]

═══════════════════════════════════════════════════════════════════
GLEICHRICHTER-TEIL (versteckter Knoten k_u2 → Connector 'out')
═══════════════════════════════════════════════════════════════════

  vDc0  = |u2| · 1.35              Leerlauf-DC-Spannung (B6-Faktor)
  r_int = 0.003 · vDc0Nenn² / pNom Innenwiderstand (0.3% bei Nennlast)
  i_dc  = max(0, (vDc0-vDc)/r_int) DC-Strom aus linearer Kennlinie
  P_dc  = U_dc · i_dc · eta        DC-Ausgangsleistung
  P_ac  = P_dc / eta               AC-Verbrauch (cos φ = 1 → nur Wirkleistung)
  Q_ac  = 0                        keine Blindleistung (Gleichrichter)

═══════════════════════════════════════════════════════════════════
STROM-TRANSFORMATION B6
═══════════════════════════════════════════════════════════════════

  I_AC_eff = i_DC · √(2/3) ≈ i_DC · 0.816   Effektivwert
  I_AC_1   = i_DC · √6/π  ≈ i_DC · 0.780   Grundschwingung (für Lastfluss)

Falsch wäre i_DC/√3 — gilt nur für reinen Sinusstrom.

═══════════════════════════════════════════════════════════════════
VORZEICHEN-KONVENTION
═══════════════════════════════════════════════════════════════════

  p1.re    < 0  — Verbrauch an k1
  p_u2_trafo > 0  — Einspeisung an k_u2 (Trafo-Teil)
  p_u2_rect  < 0  — Verbrauch an k_u2 (Gleichrichter-Teil)
  P_dc     > 0  — Einspeisung in k_dc
  u1, u2: L-L-Spannungen (komplex), i1, i2: Strangströme

Connectoren:
  in  — oben mittig   (AC-Primärseite, Knoten k1, komplex)
  out — unten mittig  (DC-Ausgang,     Knoten k_dc, reell)

Parameter:
  u1Nenn  — Primärspannung Nenn L-L in V    (default: 400)
  u2Nenn  — Sekundärspannung Nenn L-L in V  (default: 230)
  sNenn   — Nennleistung in VA              (default: 100e3)
  ukPct   — Kurzschlussspannung in %        (default: 4)
  eta     — Wirkungsgrad 0..1               (default: 0.98)
  pNom    — Nennleistung DC in W            (default: sNenn·0.98)
*/

const TRAFOGLEICHRICHTER_SVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 100">
  <rect x="4" y="4" width="52" height="92" rx="4" fill="#1a1a2e" stroke="#a0c0ff" stroke-width="1.5"/>
  <circle cx="30" cy="20" r="9" fill="none" stroke="#a0c0ff" stroke-width="1.5"/>
  <circle cx="30" cy="37" r="9" fill="none" stroke="#a0c0ff" stroke-width="1.5"/>
  <line x1="10" y1="52" x2="50" y2="52" stroke="#a0c0ff" stroke-width="0.8" stroke-dasharray="3,2" opacity="0.5"/>
  <line x1="11" y1="70" x2="22" y2="70" stroke="#f0c040" stroke-width="1.5"/>
  <line x1="41" y1="70" x2="47" y2="70" stroke="#f0c040" stroke-width="1.5"/>
  <polygon points="22,62 22,78 41,70" fill="#f0c040" stroke="#f0c040" stroke-width="1" stroke-linejoin="round"/>
  <line x1="41" y1="62" x2="41" y2="78" stroke="#f0c040" stroke-width="2"/>
  <text x="30" y="91" text-anchor="middle" fill="#f0c040" font-size="7" font-family="monospace">DC</text>
</svg>`);

class TrafoGleichrichter extends lastflussKomplexBlock {

    constructor(label, { u1Nenn = 400, u2Nenn = 230, sNenn = 100e3, ukPct = 4, eta = 0.98, pNom = null, x = null, y = null } = {}) {
        super({ x, y, imageW: 60, imageH: 100, imageSrc: TRAFOGLEICHRICHTER_SVG });
        this._label = label;
        this._pNom  = pNom ?? sNenn * 0.98;   // DC-Nennleistung für Gleichrichter-Kennlinie

        this.connectors = [
            { name: 'in',  x: '50%', y: '0%',   type: 'electrical', direction: 'up',   minLength: 24 },
            { name: 'out', x: '50%', y: '100%',  type: 'electrical', direction: 'down', minLength: 24 },
        ];

        this.params = [
            { key: 'u1Nenn', label: 'U1 Nenn', value: u1Nenn, format: v => `${(v/1000).toFixed(3)} kV`  },
            { key: 'u2Nenn', label: 'U2 Nenn', value: u2Nenn, format: v => `${(v/1000).toFixed(3)} kV`  },
            { key: 'sNenn',  label: 'S Nenn',  value: sNenn,  format: v => `${(v/1e3).toFixed(0)} kVA`  },
            { key: 'ukPct',  label: 'uk',       value: ukPct,  format: v => `${v} %`                     },
            { key: 'eta',    label: 'η',         value: eta,    format: v => `${(v*100).toFixed(1)} %`    },
        ];
    }

    // ── Versteckter Knoten ────────────────────────────────────────────────────

    /**
     * Meldet dem Simulator den versteckten AC-Knoten k_u2 (Trafo-Sekundärseite).
     * Der Simulator legt diesen Knoten automatisch an.
     * Connector-Zuordnung: dieser Block hängt mit BEIDEN internen Teilmodellen
     * an k_u2 — einmal als Lieferant (Trafo) und einmal als Verbraucher (Gleichrichter).
     */
    getHiddenNodes() {
        const u2Nenn = this.getParam('u2Nenn');
        return [{
            id:           this._uid + '.u2',      // eindeutig durch Block-Label
            type:         'ac',                   // Sekundärspannung ist AC
            connectorName: 'u2',                  // interner Connector-Name
            blocks:       [this],                 // dieser Block verwaltet beide Seiten
            uMin:   u2Nenn * 0.85,               // Scan nahe Nennspannung (Belastung ~15%)
            uMax:   u2Nenn * 1.05,               // Leerlauf leicht über Nenn
        }];
    }

    /** Block-UID für eindeutige Knoten-IDs — basiert auf Label */
    get _uid() {
        if (!this.__uid) this.__uid = this._label.replace(/[^a-zA-Z0-9]/g, '_');
        return this.__uid;
    }

    // ── Trafo-Impedanz ────────────────────────────────────────────────────────

    _zTrafo() {
        const zBase = this.getParam('u2Nenn') ** 2 / this.getParam('sNenn');
        const uk    = this.getParam('ukPct') / 100;
        const eta   = this.getParam('eta');
        return { re: zBase * (1 - eta), im: zBase * uk };
    }

    // ── Berechnung ────────────────────────────────────────────────────────────

    _calc(voltages) {
        const u1  = toC(voltages.in  ?? { re: this.getParam('u1Nenn'), im: 0 });
        const vDc = typeof voltages.out === 'number'
            ? voltages.out
            : (voltages.out ? cAbs(voltages.out) : this.getParam('u2Nenn') * 1.35);

        // u2 vom versteckten Knoten — Simulator liefert es unter connectorName 'u2'
        // hiddenId als Fallback für direkten Zugriff
        const hiddenId = this._uid + '.u2';
        const u2raw = voltages['u2'] ?? voltages[hiddenId];
        const u2 = u2raw
            ? toC(u2raw)
            : toC({ re: this.getParam('u2Nenn'), im: 0 });

        const ue     = this.getParam('u1Nenn') / this.getParam('u2Nenn');
        const zTrafo = this._zTrafo();
        const sqrt3  = Math.sqrt(3);

        // ── Trafo-Teil ───────────────────────────────────────────────────────
        const u2LL = cScale(u1, 1 / ue);                      // Leerlauf-Sekundärspannung
        const i2   = cDiv(cSub(u2LL, u2), cScale(zTrafo, sqrt3));
        const i1   = cScale(i2, 1 / ue);
        const p1   = cScale(cMul(u1,  cConj(i1)), -sqrt3);    // Verbrauch k1
        const p_u2_trafo = cScale(cMul(u2, cConj(i2)), sqrt3); // Einspeisung k_u2

        // ── Gleichrichter-Teil ───────────────────────────────────────────────
        const u2Abs  = cAbs(u2);
        const vDc0   = u2Abs * 1.35;               // Leerlauf-DC-Spannung: U_dc0 = |u2| · 1.35
        const vDcPos = Math.max(0, vDc);            // DC-Spannung nicht negativ

        // Innenwiderstand: 0.3% bei Nennlast
        const vDc0Nenn = this.getParam('u2Nenn') * 1.35;
        const r_int    = 0.003 * vDc0Nenn * vDc0Nenn / this._pNom;

        // DC-Strom aus linearer Gleichrichter-Kennlinie
        const i_dc   = Math.max(0, (vDc0 - vDcPos) / r_int);

        // DC-Leistung: P_dc = U_dc · I_dc
        const pDc    = vDcPos * i_dc;

        // AC-Verbrauch: cos φ = 1 → nur Wirkleistung, Blindleistung = 0
        // P_ac = P_dc  (Verluste stecken im Trafo-Widerstand, eta separat)
        const pAcAbs    = pDc;
        const p_u2_rect = { re: -pAcAbs, im: 0 };  // Verbrauch an k_u2

        return { u1, u2, u2Abs, vDc, vDcPos, vDc0, i1, i2, i_dc,
                 p1, p_u2_trafo, p_u2_rect, pDc, hiddenId };
    }

    // ── calcPower ─────────────────────────────────────────────────────────────

    calcPower(voltages) {
        const { p1, p_u2_trafo, p_u2_rect, pDc, hiddenId } = this._calc(voltages);

        const result = {
            in:  p1,    // komplex → k1
            out: pDc,   // reell   → k_dc
        };

        // Nettobeitrag an k_u2: Trafo speist ein, Gleichrichter verbraucht
        // Schlüssel = connectorName ('u2') damit _buildConnectorMap ihn findet
        result['u2'] = {
            re: p_u2_trafo.re + p_u2_rect.re,
            im: p_u2_trafo.im + p_u2_rect.im,
        };

        return result;
    }

    // ── Arbeitspunkt-Anzeige ─────────────────────────────────────────────────

    applyOperatingPoint(voltages) {
        const { u1, u2, u2Abs, vDc, vDc0, i_dc, p1, p_u2_trafo, pDc } = this._calc(voltages);

        this._resultFormats = {
            u1:   v => `U1: ${lastflussKomplexBlock.fmtPhasor(v)}`,
            u2:   v => `U2: ${lastflussKomplexBlock.fmtPhasor(v)}`,
            s1:   v => `S1: ${lastflussKomplexBlock.fmtPower({ re: -v.re, im: -v.im })}`,
            s2:   v => `S2: ${lastflussKomplexBlock.fmtPower(v)}`,
            vDc0: v => `vDc0: ${v.toFixed(1)} V`,
            vDc:  v => `vDc: ${v.toFixed(1)} V`,
            pDc:  v => `P_dc: ${(v/1e3).toFixed(2)} kW`,
            iDc:  v => `I_dc: ${v.toFixed(1)} A`,
            state: v => `Diode: ${v}`,
        };
        this._setResults({
            u1, u2, s1: p1, s2: p_u2_trafo, vDc0, vDc, pDc, iDc: i_dc,
            state: pDc <= 0 ? 'gesperrt' : 'leitend',
        });
    }
}

if (typeof window !== 'undefined') window.TrafoGleichrichter = TrafoGleichrichter;