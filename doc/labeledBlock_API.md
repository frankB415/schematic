# labeledBlock — API-Dokumentation

## Klassenhierarchie

```
schematicBlock          — Bild + Connectoren + leere Textpanes + Position
  └── labeledBlock      — Name + Params + Kontextmenü
        └── lastflussBlock  — calcPower + applyOperatingPoint + Results
              └── SolarPanel, Last, DCDC, ...
```

`labeledBlock` ist eine **abstrakte Zwischenklasse** — sie kann nicht direkt instanziiert werden.

---

## Einbindung

### Script-Tag (global)
```html
<script src="/schematic/schematicBlock/schematicBlock.js"></script>
<script src="/schematic/labeledBlock/labeledBlock.js"></script>
<!-- → window.labeledBlock -->
```

### ES-Modul
```js
import { labeledBlock } from '/schematic/labeledBlock/labeledBlock.module.js';
```

---

## Verantwortlichkeit

| Bereich | Beschreibung |
|---|---|
| **Name** | Label in `sb-text1` (erstes Kind, Klasse `.sb-name`) |
| **Params** | Editierbare Parameter als `.sb-property`-Einträge in `sb-text1` |
| **Kontextmenü** | Erweitert das `schematicBlock`-Menü um editierbare Param-Felder |

---

## Constructor

```js
class MyBlock extends labeledBlock {
    constructor(label, opts = {}) {
        super(opts);   // opts: { x, y, imageW, imageH }
        this._label  = label;
        this._imageSrc = '...';   // muss gesetzt werden (für render())
        this.params  = [...];
        this.connectors = [...];
    }
}
```

> `new labeledBlock(opts)` direkt wirft `Error` — nur Unterklassen erlaubt.

`opts` wird unverändert an `schematicBlock` weitergegeben:

| Parameter | Beschreibung |
|---|---|
| `x`, `y` | Mittelpunkt von `sb-image` im Schematic (px) |
| `imageW`, `imageH` | Bildgröße in px |

---

## Methoden

### `render(schematicEl)`

Standard-`render()` für `labeledBlock`. Überschreibt `schematicBlock.render()`.

```js
render(schematicEl) → this
```

Erstellt/aktualisiert `sb-image`, `sb-text1`, `sb-text2`, setzt Bild, Name, Params, Connectoren und repositioniert die Textpanes.

> **Voraussetzung:** `this._imageSrc` muss im Constructor gesetzt sein, sonst wird ein `Error` geworfen.

---

### `setName(name)`

Label in `sb-text1` setzen — idempotent.

```js
block.setName('R1');
```

Wird als `.sb-name`-Element als erstes Kind in `sb-text1` eingefügt (vor den Params). Kein Effect wenn `_text1Div` noch nicht existiert.

---

### `getParam(key)`

Parameter-Rohwert lesen.

```js
const r = block.getParam('R');   // → 100
```

| Parameter | Beschreibung |
|---|---|
| `key` | Schlüssel des gesuchten Params |

Gibt `undefined` zurück wenn der Key nicht existiert oder `this.params` nicht gesetzt ist.

---

### `setParam(key, value)`

Parameter-Wert setzen, DOM aktualisieren, Event feuern.

```js
block.setParam('R', 220);
```

| Parameter | Beschreibung |
|---|---|
| `key` | Schlüssel des zu ändernden Params |
| `value` | Neuer Wert (wird im `params`-Array gespeichert) |

- Aktualisiert `p.value` im `this.params`-Array
- Ruft `_setProperty()` auf (DOM-Update)
- Feuert `sb-param-change` auf `sb-image` (bubbles)
- Ruft `_repositionText()` auf

Kein Effekt wenn `key` nicht in `this.params` oder `_text1Div` fehlt.

---

### `renderParams()`

Alle `this.params` als `.sb-property`-Einträge in `sb-text1` rendern — idempotent.

```js
block.renderParams();
```

Iteriert über `this.params` und ruft für jeden Eintrag `_setProperty(key, formattedValue)` auf.

---

### `_setProperty(key, value)` *(intern)*

Einzelne Eigenschaft in `sb-text1` setzen — idempotent (matcht über `data-key`).

```js
block._setProperty('R', '220 Ω');
```

Erstellt bei Bedarf einen `.sb-properties`-Container in `sb-text1`. Legt ein `div.sb-property[data-key]`-Element an oder aktualisiert es.

---

### `getContextMenuItems()`

Erweiterungspunkt für eigene Kontextmenü-Einträge.

```js
// Standard-Implementierung gibt leeres Array zurück
getContextMenuItems() { return []; }

// Überschreiben in der Unterklasse:
getContextMenuItems() {
    return [
        { label: '⚡ Simulieren', action: () => this.simulate() },
    ];
}
```

---

## Param-Schema

```js
this.params = [
    { key: 'R',   label: 'Widerstand', value: 100, format: v => `${v} Ω` },
    { key: 'tol', label: 'Toleranz',   value: 0.05, format: v => `${(v*100).toFixed(0)} %` },
];
```

| Feld | Typ | Beschreibung |
|---|---|---|
| `key` | `string` | Eindeutiger Schlüssel (für `getParam`/`setParam`) |
| `label` | `string` | Anzeigetext im Kontextmenü |
| `value` | `number` | Aktueller Wert |
| `format` | `(v) => string` | Formatierungsfunktion für die Anzeige im DOM |

---

## Kontextmenü

Das Kontextmenü enthält automatisch:

1. **Basis-Einträge** (von `schematicBlock`): Drehen, Src anzeigen, Löschen
2. **Eigene Einträge** aus `getContextMenuItems()`
3. **Trennlinie** (wenn `this.params.length > 0`)
4. **Editierbare Param-Felder** — `<input type="number">` je Param; `change`-Event ruft `setParam()` auf

---

## Events

Alle Events feuern auf `.sb-image` mit `bubbles: true`.

| Event | `detail` | Auslöser |
|---|---|---|
| `sb-param-change` | `{ block, key, value }` | `setParam()` |
| `sb-select` | `{ block }` | `select()` (von `schematicBlock`) |
| `sb-rotate` | `{ block, rotation }` | `rotate()` (von `schematicBlock`) |
| `sb-delete` | `{ block }` | `delete()` (von `schematicBlock`) |

---

## Minimales Beispiel

```js
class ResistorBlock extends labeledBlock {
    constructor(label, opts = {}) {
        super(opts);
        this._label    = label;
        this._imageSrc = '/img/resistor.svg';
        this.connectors = [
            { name: 'left',  x: '0%',   y: '50%', type: 'electrical', direction: 'left',  minLength: 20 },
            { name: 'right', x: '100%', y: '50%', type: 'electrical', direction: 'right', minLength: 20 },
        ];
        this.params = [
            { key: 'R', label: 'Widerstand', value: 100, format: v => `${v} Ω` },
        ];
    }
}

const r1 = new ResistorBlock('R1', { x: 200, y: 150, imageW: 80, imageH: 32 });
r1.render(document.getElementById('schematic'));

// Parameter zur Laufzeit ändern:
r1.setParam('R', 220);

// Auf Änderung reagieren:
document.getElementById('schematic').addEventListener('sb-param-change', e => {
    console.log(e.detail.key, '=', e.detail.value);
});
```
