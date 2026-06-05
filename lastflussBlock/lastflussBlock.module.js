/*
lastflussBlock.module.js — ES-Modul-Wrapper
import { lastflussBlock } from '/schematic/lastflussBlock/lastflussBlock.module.js'
*/
await import('/schematic/schematicBlock/schematicBlock.js');
await import('/schematic/labeledBlock/labeledBlock.js');
await import('./lastflussBlock.js');
export const lastflussBlock = window.lastflussBlock;
export default window.lastflussBlock;
