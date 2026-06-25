/*
dcdcDroop.js — Schaltplan-Block: DC/DC-Wandler mit Droop-Regelung und Spannungsbandüberwachung
Ableitung von lastflussBlock (analog zu dcdc.js)

═══════════════════════════════════════════════════════════════
  ANFORDERUNGEN
═══════════════════════════════════════════════════════════════

  PARAMETER
  ─────────
  vNomIn            — Nennspannung Eingang            [V]   (default: 48)
  vNomOut           — Nennspannung Ausgang            [V]   (default: 24)
  eta               — Wirkungsgrad 0..1                     (default: 0.95)
  pNom              — Nennleistung                    [W]   (default: 500)
  pRef              — Referenz-/Sollleistung Ausgang  [W]   (default: 0)
  kDroop            — Droop-Konstante                 [%]   (default: 5)
  vBandIn           — Spannungsband Eingang           [%]   (default: 10)
  vBandOut          — Spannungsband Ausgang           [%]   (default: 10)
  vMaxIn            — Überspannungsgrenze Eingang     [%]   (default: 20)
                      relativ zu vNomIn, z.B. 20 → Abschaltung ab 1.20 * vNomIn
  vMaxOut           — Überspannungsgrenze Ausgang     [%]   (default: 20)
                      relativ zu vNomOut

  ───────────────────────────────────────────────────────────
  VORZEICHEN-KONVENTION (Solver)
  ───────────────────────────────────────────────────────────
  Positiver Rückgabewert = Knoten nimmt Leistung auf (Senke)
  Negativer Rückgabewert = Knoten speist Leistung ein (Quelle)

  pAct > 0  → FWD: in → out  (Vorzugsrichtung)
  pAct < 0  → REV: out → in  (Rückspeisung)

  ───────────────────────────────────────────────────────────
  DEFINITION pNom — Erzeuger-Konvention
  ───────────────────────────────────────────────────────────
  pNom ist die maximale abgegebene Leistung an die Senke,
  unabhängig von der Richtung. Der Verbraucher bekommt immer
  maximal pNom, die Quelle trägt die Verluste:

    FWD (pAct > 0):  Senke=out bekommt |pAct|       Quelle=in  liefert |pAct|/eta
    REV (pAct < 0):  Senke=in  bekommt |pAct|       Quelle=out liefert |pAct|/eta

  Clamp bezieht sich immer auf die Senke:
    pAct = clamp(pAct, -pNom, +pNom)

  ───────────────────────────────────────────────────────────
  VERLUSTFORMEL — richtungsabhängig
  ───────────────────────────────────────────────────────────
  FWD (pAct >= 0):
    return.out = +pAct              // Senke nimmt pAct auf
    return.in  = -(pAct / eta)      // Quelle liefert pAct/eta

  REV (pAct < 0):
    return.in  = -pAct              // Senke nimmt |pAct| auf  (positiv, da pAct<0)
    return.out = +(pAct * eta)      // Quelle liefert |pAct|/eta (negativ)

  Beispiel FWD: pAct=+100W, eta=0.95
    → out bekommt +100 W,  in  liefert −105.26 W

  Beispiel REV: pAct=−100W, eta=0.95
    → in  bekommt +100 W,  out liefert −105.26 W

  ───────────────────────────────────────────────────────────
  BIDIREKTIONALER BETRIEB — Richtungsmodi
  ───────────────────────────────────────────────────────────
  pStandby = 0.01 * pNom  (1%-Schwelle, kein eigener Parameter)

    pAct >  +pStandby  → FWD   (Vorwärts)
    pAct < −pStandby   → REV   (Rückwärts)
    sonst              → STBY  (Standby)

  ───────────────────────────────────────────────────────────
  REGELSCHICHT 1 — Droop (Grundverhalten)
  ───────────────────────────────────────────────────────────
  Die Leistungsabweichung von pRef erzeugt eine pu-Spannungsabweichung:

    (pRef - pAct) * kDroop_pu = vIn_pu - vOut_pu

  Aufgelöst nach pAct:
    pAct = pRef - (vIn_pu - vOut_pu) / kDroop_pu

  Mit:
    vIn_pu    = vIn  / vNomIn
    vOut_pu   = vOut / vNomOut
    kDroop_pu = kDroop / 100

  Bedeutung kDroop:
    Bei Δu_pu = kDroop_pu weicht pAct um pNom von pRef ab.
    Beispiel kDroop=5%: Δu_pu=0.05 → pAct = pRef ± pNom

  ───────────────────────────────────────────────────────────
  REGELSCHICHT 2 — Spannungsbandüberwachung
  ───────────────────────────────────────────────────────────
  Für Eingang und Ausgang gilt je ein symmetrisches Band um vNom:

    vInMin  = vNomIn  * (1 − vBandIn  / 100)
    vInMax  = vNomIn  * (1 + vBandIn  / 100)
    vOutMin = vNomOut * (1 − vBandOut / 100)
    vOutMax = vNomOut * (1 + vBandOut / 100)

  Verlässt eine Spannung ihr Band, wird pAct mit einem zusätzlichen
  Droop-artigen Term korrigiert (gleicher Mechanismus wie kDroop,
  aber bezogen auf die Bandgrenze) damit der Solver glatt konvergiert:

    bandCorrIn  = (vIn_pu  - vInBand_pu)  / kDroop_pu   wenn vIn  außerhalb Band
    bandCorrOut = (vOut_pu - vOutBand_pu) / kDroop_pu   wenn vOut außerhalb Band

  Dabei ist vInBand_pu / vOutBand_pu die nächste Bandgrenze in pu.
  Sind beide Seiten gleichzeitig verletzt, überlagern sich die
  Korrekturen — der Solver findet iterativ das Gleichgewicht.

  ───────────────────────────────────────────────────────────
  REGELSCHICHT 3 — Nennleistungsbegrenzung
  ───────────────────────────────────────────────────────────
  Nach Droop + Bandkorrektur wird pAct hart auf die Senke begrenzt:

    pAct = clamp(pAct, -pNom, +pNom)

  Absolut — Droop und Bandkorrektur können diese Grenze nicht überschreiben.

  ───────────────────────────────────────────────────────────
  STROMBEGRENZUNG — weiche Begrenzung (ILim)
  ───────────────────────────────────────────────────────────
  Maximalströme aus Nennleistung und Nennspannung (kein eigener Parameter):

    iMaxIn  = pNom / vNomIn
    iMaxOut = pNom / vNomOut

  Tatsächliche Ströme im Betrieb (richtungsabhängig):
    FWD: iIn  = (pAct / eta) / vIn      iOut = pAct / vOut
    REV: iIn  = |pAct| / vIn            iOut = (|pAct| / eta) / vOut

  Weiche Begrenzung über ein 2%-Fenster oberhalb iMax:
    iFadeIn  = iMaxIn  * 1.02
    iFadeOut = iMaxOut * 1.02

  Skalierungsfaktor (1.0 = kein Eingriff, 0.0 = vollständig begrenzt):
    factorILim = clamp(1 − (iIn  − iMaxIn)  / (iFadeIn  − iMaxIn),  0, 1)
               * clamp(1 − (iOut − iMaxOut) / (iFadeOut − iMaxOut), 0, 1)

  pAct = pAct * factorILim

  Wird NACH pNom-Clamp angewendet, unabhängig von factorOVP.
  factorILim und factorOVP sind getrennte Größen — beide im Result ausgegeben.

  ───────────────────────────────────────────────────────────
  ÜBERSPANNUNGSSCHUTZ — weiche Abschaltung (OVP)
  ───────────────────────────────────────────────────────────
  Pro Seite eine Überspannungsgrenze, ab der der Wandler weich abschaltet:

    vShutdownIn  = vNomIn  * (1 + vMaxIn  / 100)
    vShutdownOut = vNomOut * (1 + vMaxOut / 100)

  Weiche Abschaltung über ein 2%-Fenster oberhalb der Grenze:
    vFadeIn  = vShutdownIn  * 1.02
    vFadeOut = vShutdownOut * 1.02

  Skalierungsfaktor (1.0 = voll aktiv, 0.0 = abgeschaltet):
    factorOVP = clamp(1 − (vIn  − vShutdownIn)  / (vFadeIn  − vShutdownIn),  0, 1)
              * clamp(1 − (vOut − vShutdownOut) / (vFadeOut − vShutdownOut), 0, 1)

  pAct = pAct * factorOVP

  Wird NACH ILim angewendet — OVP deaktiviert den Wandler, begrenzt ihn nicht.

  ───────────────────────────────────────────────────────────
  AUSWERTUNGSREIHENFOLGE in calcPower()
  ───────────────────────────────────────────────────────────
  1. pAct_droop = pRef − (vIn_pu − vOut_pu) / kDroop_pu
  2. pAct_band  = pAct_droop + Bandkorrektur(vIn, vOut)
  3. pAct_clamp = clamp(pAct_band, −pNom, +pNom)
  4. factorILim = f(iIn, iOut)                                 // Strombegrenzung
  5. pAct_ilim  = pAct_clamp * factorILim
  6. factorOVP  = f(vIn, vOut)                                 // Überspannungsschutz
  7. pAct       = pAct_ilim * factorOVP
  8. Verlustformel richtungsabhängig anwenden (s.o.)
  9. return { in: ..., out: ... }

  ───────────────────────────────────────────────────────────
  MODUS-BESTIMMUNG
  ───────────────────────────────────────────────────────────
  Priorität (höchste zuerst — nur der erste zutreffende):

    1. "OVP"     — Überspannungsschutz aktiv   (factorOVP < 1.0)
    2. "ILim"    — Strombegrenzung aktiv        (factorILim   < 1.0)
    3. "P-Limit" — Nennleistungsgrenze aktiv   (|pAct_band| > pNom)
    4. "V-Band"  — Bandkorrektur aktiv         (Bandkorrektur ≠ 0)
    5. "Droop"   — reiner Droop-Betrieb        (Normalfall)

  Richtungs-Suffix immer anhängen:
    " FWD"   — pAct >  +pStandby
    " REV"   — pAct < −pStandby
    " STBY"  — sonst

  Beispiele:
    "Droop FWD"    — normaler Vorwärtsbetrieb
    "V-Band REV"   — Rückwärtsbetrieb, Bandkorrektur aktiv
    "P-Limit FWD"  — Vorwärts, Nennleistung ausgeschöpft
    "OVP STBY"     — Überspannung, Wandler abgeschaltet

  ───────────────────────────────────────────────────────────
  CONNECTOREN
  ───────────────────────────────────────────────────────────
  in  — oben mittig  (Eingang,  Knoten 1)   direction: 'up'
  out — unten mittig (Ausgang,  Knoten 2)   direction: 'down'

  ───────────────────────────────────────────────────────────
  ANZEIGE
  ───────────────────────────────────────────────────────────
  params:  vNomIn, vNomOut, eta, pNom, pRef, kDroop, vBandIn, vBandOut, vMaxIn, vMaxOut
  results: pIn, pOut, uIn, uOut, factorILim (0..1), factorOVP (0..1), mode (String)

  ───────────────────────────────────────────────────────────
  ABGRENZUNG zu dcdc.js
  ───────────────────────────────────────────────────────────
  dcdc.js:      feste couplingImpedance, kein Arbeitspunkt, kein Band,
                Verlustformel nur für FWD korrekt
  dcdcDroop.js: kDroop [%] + pRef als Arbeitspunkt,
                Spannungsbandüberwachung (vBandIn/Out),
                harte pNom-Begrenzung (Erzeuger-Konvention),
                weiche OVP-Abschaltung (vMaxIn/Out, 2%-Fenster),
                richtungsabhängige Verlustformel (FWD/REV korrekt)

═══════════════════════════════════════════════════════════════
  IMPLEMENTIERUNG
═══════════════════════════════════════════════════════════════
*/

const DCDC_DROOP_SVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 80">
  <!-- Hintergrund -->
  <rect x="4" y="4" width="52" height="72" rx="4" fill="#1a1a2e" stroke="#c0a080" stroke-width="1.5"/>
  <!-- Anschlusslinien oben/unten -->
  <line x1="30" y1="0"  x2="30" y2="14" stroke="#c0a080" stroke-width="2"/>
  <line x1="30" y1="66" x2="30" y2="80" stroke="#c0a080" stroke-width="2"/>
  <!-- Konverter-Symbol -->
  <rect x="12" y="18" width="36" height="44" rx="0"
        fill="none" stroke="#c0a080" stroke-width="1.5"/>
  <!-- Diagonale -->
  <line x1="12" y1="62" x2="48" y2="18" stroke="#c0a080" stroke-width="1.5"/>
  <!-- Eingangsseite: zwei Gleichstromlinien (oben links) -->
  <line x1="16" y1="28" x2="26" y2="28" stroke="#c0a080" stroke-width="1.5"/>
  <line x1="16" y1="33" x2="26" y2="33" stroke="#c0a080" stroke-width="1.5"/>
  <!-- Ausgangsseite: zwei Gleichstromlinien (unten rechts) -->
  <line x1="34" y1="47" x2="44" y2="47" stroke="#c0a080" stroke-width="1.5"/>
  <line x1="34" y1="52" x2="44" y2="52" stroke="#c0a080" stroke-width="1.5"/>
</svg>`);

class DCDCDroop extends lastflussBlock {

    constructor(label, {
        vNomIn   = 48,
        vNomOut  = 24,
        eta      = 0.95,
        pNom     = 500,
        pRef     = 0,
        kDroop   = 5,
        vBandIn  = 10,
        vBandOut = 10,
        vMaxIn   = 20,
        vMaxOut  = 20,
        x = null, y = null,
    } = {}) {
        super({ x, y, imageW: 60, imageH: 80, imageSrc: DCDC_DROOP_SVG });
        this._label  = label;
        this.vNomIn  = vNomIn;
        this.vNomOut = vNomOut;
        this.eta     = eta;
        this.pNom    = pNom;
        this.pRef    = pRef;
        this.kDroop  = kDroop;
        this.vBandIn  = vBandIn;
        this.vBandOut = vBandOut;
        this.vMaxIn   = vMaxIn;
        this.vMaxOut  = vMaxOut;

        this.connectors = [
            { name: 'in',  x: '50%', y: '0%',   type: 'electrical', direction: 'up',   minLength: 24 },
            { name: 'out', x: '50%', y: '100%',  type: 'electrical', direction: 'down', minLength: 24 },
        ];

        this.params = [
            { key: 'vNomIn',  value: vNomIn,  format: v => `${(v/1000).toFixed(3)} kV` },
            { key: 'vNomOut', value: vNomOut, format: v => `${(v/1000).toFixed(3)} kV` },
            { key: 'pNom',    value: pNom,    format: v => `${(v/1000).toFixed(1)} kW` },
            { key: 'pRef',    value: pRef,    format: v => `${(v/1000).toFixed(1)} kW` },
            { key: 'kDroop',  value: kDroop,  format: v => `${v} %`                    },
            { key: 'eta',     value: eta,     format: v => `${v}`                      },
            { key: 'vBandIn', value: vBandIn, format: v => `${v} %`                    },
            { key: 'vBandOut',value: vBandOut,format: v => `${v} %`                    },
            { key: 'vMaxIn',  value: vMaxIn,  format: v => `${v} %`                    },
            { key: 'vMaxOut', value: vMaxOut, format: v => `${v} %`                    },
        ];
    }

    // ── Hilfsfunktionen ───────────────────────────────────────────────────────

    static _clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

    /** Weicher Skalierungsfaktor: 1.0 bei x<=limit, linear auf 0.0 bei x>=limit*1.02 */
    static _softFactor(x, limit) {
        if (x <= limit) return 1.0;
        const fade = limit * 1.02;
        return DCDCDroop._clamp(1 - (x - limit) / (fade - limit), 0, 1);
    }

    // ── Kernberechnung ────────────────────────────────────────────────────────

    /**
     * Interne Berechnung — gibt pAct + diagnostische Zwischenwerte zurück.
     * Kein Seiteneffekt.
     */
    _calc(vIn, vOut) {
        const kDroop_pu = this.kDroop / 100;
        const vIn_pu    = vIn  / this.vNomIn;
        const vOut_pu   = vOut / this.vNomOut;

        // ── Regelschicht 1: Droop ─────────────────────────────────────────────
        // vIn_pu > vOut_pu → Leistung fließt von in nach out (FWD, pAct > 0)
        const pAct_droop = this.pRef + (vIn_pu - vOut_pu) / kDroop_pu * this.pNom;

        // ── Regelschicht 2: Spannungsband ─────────────────────────────────────
        // Bandgrenzen in pu
        const vInMin_pu  = 1 - this.vBandIn  / 100;
        const vInMax_pu  = 1 + this.vBandIn  / 100;
        const vOutMin_pu = 1 - this.vBandOut / 100;
        const vOutMax_pu = 1 + this.vBandOut / 100;

        // Abweichung von der nächsten Bandgrenze — Vorzeichen so dass pAct
        // in Richtung Bandgrenze korrigiert wird:
        //   vIn zu niedrig → pAct reduzieren (weniger vom Eingang ziehen)
        //   vIn zu hoch    → pAct erhöhen    (mehr vom Eingang ziehen)
        //   vOut zu niedrig → pAct reduzieren
        //   vOut zu hoch   → pAct erhöhen
        let bandCorrIn = 0;
        if      (vIn_pu < vInMin_pu) bandCorrIn = -(vInMin_pu - vIn_pu)  / kDroop_pu * this.pNom;
        else if (vIn_pu > vInMax_pu) bandCorrIn =  (vIn_pu  - vInMax_pu) / kDroop_pu * this.pNom;

        let bandCorrOut = 0;
        if      (vOut_pu < vOutMin_pu) bandCorrOut =  (vOutMin_pu - vOut_pu) / kDroop_pu * this.pNom;
        else if (vOut_pu > vOutMax_pu) bandCorrOut = -(vOut_pu - vOutMax_pu) / kDroop_pu * this.pNom;

        const bandCorr   = bandCorrIn + bandCorrOut;
        const bandActive = Math.abs(bandCorr) > 1e-6;
        const pAct_band  = pAct_droop + bandCorr;

        // ── Regelschicht 3: pNom-Clamp ────────────────────────────────────────
        const pLimitActive = Math.abs(pAct_band) > this.pNom;
        const pAct_clamp   = DCDCDroop._clamp(pAct_band, -this.pNom, this.pNom);

        // ── Strombegrenzung (ILim) ────────────────────────────────────────────
        // iMax = absolutes Hardware-Stromlimit (bei Nennspannung = pNom/eta lieferbar)
        // Bei niedrigerer Spannung reduziert sich die übertragbare Leistung: pMax = iMax * vAct
        const iMaxIn  = this.pNom / this.eta / this.vNomIn  * 1.05;
        const iMaxOut = this.pNom / this.eta / this.vNomOut * 1.05;
        const safeVIn  = Math.max(Math.abs(vIn),  0.1);
        const safeVOut = Math.max(Math.abs(vOut), 0.1);

        // Maximale Leistung begrenzt durch Strom × tatsächliche Spannung (richtungsabhängig)
        // FWD: Quelle=in  → pMax durch iMaxIn * vIn  UND Senke=out → pMax durch iMaxOut * vOut
        // REV: Quelle=out → pMax durch iMaxOut * vOut UND Senke=in  → pMax durch iMaxIn * vIn
        let pMaxByILim;
        if (pAct_clamp >= 0) {
            // FWD: in liefert pAct/eta, out empfängt pAct
            const pMaxIn  = iMaxIn  * safeVIn  * this.eta;  // max pAct sodass iIn <= iMaxIn
            const pMaxOut = iMaxOut * safeVOut;              // max pAct sodass iOut <= iMaxOut
            pMaxByILim = Math.min(pMaxIn, pMaxOut);
        } else {
            // REV: out liefert |pAct|/eta, in empfängt |pAct|
            const pMaxOut = iMaxOut * safeVOut * this.eta;   // max |pAct| sodass iOut <= iMaxOut
            const pMaxIn  = iMaxIn  * safeVIn;               // max |pAct| sodass iIn  <= iMaxIn
            pMaxByILim = Math.min(pMaxOut, pMaxIn);
        }
        pMaxByILim = Math.max(0, pMaxByILim);

        const pAct_ilim  = pAct_clamp >= 0
            ? Math.min(pAct_clamp,  pMaxByILim)
            : Math.max(pAct_clamp, -pMaxByILim);
        const factorILim = Math.abs(pAct_clamp) > 1e-6
            ? Math.abs(pAct_ilim) / Math.abs(pAct_clamp)
            : 1.0;

        // ── Überspannungsschutz (OVP) ─────────────────────────────────────────
        const vShutdownIn  = this.vNomIn  * (1 + this.vMaxIn  / 100);
        const vShutdownOut = this.vNomOut * (1 + this.vMaxOut / 100);
        const factorOVP    = DCDCDroop._softFactor(vIn,  vShutdownIn)
                           * DCDCDroop._softFactor(vOut, vShutdownOut);
        const pAct         = pAct_ilim * factorOVP;

        return { pAct, pAct_band, factorILim, factorOVP, bandActive, pLimitActive };
    }

    // ── Verlustformel (richtungsabhängig) ────────────────────────────────────

    _applyLoss(pAct) {
        if (pAct >= 0) {
            // FWD: out = Senke bekommt pAct, in = Quelle liefert pAct/eta
            return { in: -(pAct / this.eta), out: pAct };
        } else {
            // REV: in = Senke bekommt |pAct|, out = Quelle liefert |pAct|/eta
            return { in: -pAct, out: -(Math.abs(pAct) / this.eta) };
        }
    }

    // ── Modus-String ─────────────────────────────────────────────────────────

    _modeString(pAct, factorOVP, factorILim, pLimitActive, bandActive) {
        const pStandby = 0.01 * this.pNom;

        // Regeleingriff (Priorität höchste zuerst)
        let regelMode;
        if      (factorOVP  < 1.0 - 1e-6) regelMode = 'OVP';
        else if (factorILim < 1.0 - 1e-6) regelMode = 'ILim';
        else if (pLimitActive)             regelMode = 'P-Limit';
        else if (bandActive)               regelMode = 'V-Band';
        else                               regelMode = 'Droop';

        // Richtung
        let dir;
        if      (pAct >  pStandby) dir = 'FWD';
        else if (pAct < -pStandby) dir = 'REV';
        else                       dir = 'STBY';

        return `${regelMode} ${dir}`;
    }

    // ── lastflussBlock Interface ──────────────────────────────────────────────

    calcCurrent(voltages) {
        const vIn  = voltages.in  ?? this.vNomIn;
        const vOut = voltages.out ?? this.vNomOut;
        const { pAct } = this._calc(vIn, vOut);
        const { in: pIn, out: pOut } = this._applyLoss(pAct);
        // P = U * I → I = P / U, Vorzeichen gemaess calcPower-Konvention
        const safeVIn  = Math.max(1, Math.abs(vIn));
        const safeVOut = Math.max(1, Math.abs(vOut));
        return {
            in:  pIn  / safeVIn,
            out: pOut / safeVOut,
        };
    }

    calcPower(voltages) {
        throw new Error('DCDCDroop.calcPower() ist nicht mehr unterstuetzt — calcCurrent() verwenden.');
    }

    applyOperatingPoint(voltages) {
        const vIn  = voltages.in  ?? this.vNomIn;
        const vOut = voltages.out ?? this.vNomOut;

        const { pAct, pAct_band, factorILim, factorOVP, bandActive, pLimitActive }
            = this._calc(vIn, vOut);

        const { in: pIn, out: pOut } = this._applyLoss(pAct);
        const safeVIn  = Math.max(Math.abs(vIn),  0.1);
        const safeVOut = Math.max(Math.abs(vOut), 0.1);
        const iIn  = -pIn  / safeVIn;
        const iOut =  pOut / safeVOut;
        const mode = this._modeString(pAct, factorOVP, factorILim, pLimitActive, bandActive);

        this.renderResults([
            { key: 'uIn',       text: `uIn:   ${(vIn /1000).toFixed(3)} kV`           },
            { key: 'uOut',      text: `uOut:  ${(vOut/1000).toFixed(3)} kV`           },
            { key: 'pIn',       text: `pIn:   ${(-pIn /1000).toFixed(2)} kW`          },
            { key: 'pOut',      text: `pOut:  ${( pOut/1000).toFixed(2)} kW`          },
            { key: 'iIn',       text: `iIn:   ${iIn.toFixed(1)} A`                    },
            { key: 'iOut',      text: `iOut:  ${iOut.toFixed(1)} A`                   },
            { key: 'factorILim',text: `ILim:  ${(factorILim * 100).toFixed(1)} %`     },
            { key: 'factorOVP', text: `OVP:   ${(factorOVP  * 100).toFixed(1)} %`     },
            { key: 'mode',      text: `Modus: ${mode}`                                },
        ]);
    }
}

if (typeof window !== 'undefined') window.DCDCDroop = DCDCDroop;