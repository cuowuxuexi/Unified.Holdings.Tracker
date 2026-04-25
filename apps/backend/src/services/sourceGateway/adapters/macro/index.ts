export { MACRO_INDICATORS, getMacroIndicatorDefinition } from './catalog';
export {
  FredMacroIndicatorAdapter,
  createFredMacroIndicatorAdapter,
} from './fredMacroIndicatorAdapter';
export { normalizeFredObservations } from './normalizer';
export type {
  MacroHttpFetcher,
  MacroHttpResponse,
  MacroIndicatorDefinition,
  MacroIndicatorId,
  MacroIndicatorRequest,
  MacroIndicatorSnapshot,
  MacroIndicatorSeries,
} from './types';
