/*
labeledBlock.module.js — ES-Modul-Wrapper
import { labeledBlock } from '/schematic/labeledBlock/labeledBlock.module.js'
*/
await import('/schematic/schematicBlock/schematicBlock.js');
await import('./labeledBlock.js');
export const labeledBlock = window.labeledBlock;
export default window.labeledBlock;
