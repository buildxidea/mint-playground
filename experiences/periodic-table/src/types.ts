export interface ElementData {
  z: number;
  symbol: string;
  name: string;
  category: CategoryKey;
  period: number | null;
  group: number | null;
  xpos: number;
  ypos: number;
  phase: string | null;
  summary: string | null;
  discoveredBy: string | null;
  yearDiscovered: string | null;
  mass: number | null;
  neutrons: number | null;
  shells: number[];
  ecFull: string | null;
  ecSemantic: string | null;
  electronegativity: number | null;
  ionizationEnergy: number | null;
  electronAffinity: number | null;
  oxidationStates: string | null;
  atomicRadius: number | null;
  covalentRadius: number | null;
  density: number | null;
  densityUnit: string;
  melt: number | null;
  boil: number | null;
  molarHeat: number | null;
  thermalConductivity: number | null;
  electricalConductivity: number | null;
  mohs: number | null;
  youngs: number | null;
}

export type CategoryKey =
  | 'alkali'
  | 'alkaline'
  | 'transition'
  | 'postTransition'
  | 'metalloid'
  | 'nonmetal'
  | 'halogen'
  | 'nobleGas'
  | 'lanthanide'
  | 'actinide'
  | 'unknown';

export type Finish = 'glossy' | 'matte' | 'metallic' | 'satin';
export type Background = 'black' | 'white';
export type ColorMode = 'category' | 'mono';
export type BoardMaterial = 'wood' | 'plastic';

export interface Settings {
  finish: Finish;
  board: BoardMaterial;
  background: Background;
  colorMode: ColorMode;
  sound: 'on' | 'off';
}
