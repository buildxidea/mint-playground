import type { CategoryKey } from './types';

export interface LegendRow {
  key: CategoryKey;
  label: string;
}

/** Order and wording of the 3D legend board, grouped the way the table is. */
export const LEGEND_ROWS: LegendRow[] = [
  { key: 'alkali', label: 'Alkali metals' },
  { key: 'alkaline', label: 'Alkaline earth' },
  { key: 'transition', label: 'Transition metals' },
  { key: 'postTransition', label: 'Post-transition' },
  { key: 'lanthanide', label: 'Lanthanoids' },
  { key: 'actinide', label: 'Actinoids' },
  { key: 'metalloid', label: 'Metalloids' },
  { key: 'nonmetal', label: 'Reactive nonmetals' },
  { key: 'halogen', label: 'Halogens' },
  { key: 'nobleGas', label: 'Noble gases' },
  { key: 'unknown', label: 'Unknown' },
];
