/*
wireBlocks.js — Hilfsfunktion zum einfachen Verbinden von Schaltplan-Blöcken
Abhängigkeit: electricalWire.js (ElectricalWire muss geladen sein)

API:
    wireBlocks(schematic, blocks, connections, opts)

Parameter:
    schematic   — HTMLElement, das Schaltplan-Container-Element
    blocks      — Array von schematicBlock-Instanzen
    connections — Array von { id, from, to, ... }
                  from/to als "Label.connectorName"
                  Beispiel: { id: 'k1', from: 'Quelle.out', to: 'TR1.in' }
    opts        — optional, ElectricalWire-Optionen
                  Default: { gridSize: 10, wireColor: '#a0c0ff', wireWidth: 1.5, shrink: 5 }

Label-Eindeutigkeit:
    Falls zwei Blöcke dasselbe _label haben, wird intern ein zufälliges Suffix angehängt.
    console.warn gibt den Konflikt aus.

Rückgabe:
    ElectricalWire-Instanz (nach render())

Beispiel:
    const blocks = [quelle, trafo, last];
    const connections = [
        { id: 'k1', from: 'Quelle.out', to: 'TR1.in',  uMin: 350, uMax: 450 },
        { id: 'k2', from: 'TR1.out',    to: 'Last.in',  uMin: 180, uMax: 280 },
    ];
    const sim = new lastflussKomplexSim(blocks, connections, { logging: true });
    wireBlocks(schematic, blocks, connections);
*/

function wireBlocks(schematic, blocks, connections, opts = {}) {

    // ── Label → sanitized Prefix ──────────────────────────────────────────────
    // Bindestriche und Sonderzeichen im Prefix können Probleme verursachen
    function sanitize(lbl) {
        return lbl.replace(/[^a-zA-Z0-9_]/g, '_');
    }

    const labelMap   = new Map();   // block → prefix
    const labelCount = {};

    for (const block of blocks) {
        const lbl = block._label ?? block.constructor.name;
        labelCount[lbl] = (labelCount[lbl] ?? 0) + 1;
    }

    for (const block of blocks) {
        const lbl = block._label ?? block.constructor.name;
        if (labelCount[lbl] > 1) {
            const suffix = Math.random().toString(36).slice(2, 6);
            const unique = `${sanitize(lbl)}_${suffix}`;
            console.warn(
                `[wireBlocks] Label "${lbl}" ist nicht eindeutig — ` +
                `Block ${block.constructor.name} bekommt internen Prefix "${unique}".`
            );
            labelMap.set(block, unique);
        } else {
            labelMap.set(block, sanitize(lbl));
        }
    }

    // Reverse-Map: originalLabel → sanitizedPrefix
    const origToUnique = {};
    for (const block of blocks) {
        const lbl    = block._label ?? block.constructor.name;
        const prefix = labelMap.get(block);
        if (!origToUnique[lbl]) origToUnique[lbl] = prefix;
    }

    // ── Connectors sammeln ────────────────────────────────────────────────────
    const connectors = [];
    for (const block of blocks) {
        const prefix = labelMap.get(block);
        connectors.push(...block.getConnectorPositions(schematic, prefix));
    }

    // ── Connections remappen ──────────────────────────────────────────────────
    function remapEndpoint(endpoint) {
        const dot = endpoint.lastIndexOf('.');
        if (dot < 0) return endpoint;
        const lbl    = endpoint.slice(0, dot);
        const conn   = endpoint.slice(dot + 1);
        const prefix = origToUnique[lbl] ?? lbl;
        return `${prefix}.${conn}`;
    }

    const remappedConnections = connections.map((c, i) => ({
        id:   `${c.id}_${i}`,   // ElectricalWire braucht eindeutige IDs
        from: remapEndpoint(c.from),
        to:   remapEndpoint(c.to),
    }));

    // ── Blocked Areas ─────────────────────────────────────────────────────────
    const blocked = blocks.map(b => b.getImageDiv()).filter(Boolean);

    // ── ElectricalWire ────────────────────────────────────────────────────────
    const { shrink = 5, ...wireOpts } = opts;
    console.log('[wireBlocks] connectors:', connectors.length, 'connections:', remappedConnections.length, 'blocked:', blocked.length);
    console.log('[wireBlocks] remapped:', remappedConnections.map(c => `${c.from}→${c.to}`));
    const wire = new ElectricalWire(schematic, {
        gridSize:  10,
        wireColor: '#a0c0ff',
        wireWidth: 1.5,
        ...wireOpts,
    });
    wire.setConnectors(connectors);
    wire.setConnections(remappedConnections);
    wire.setBlockedAreas(blocked, { shrink });
    wire.render();

    return wire;
}

if (typeof window !== 'undefined') window.wireBlocks = wireBlocks;