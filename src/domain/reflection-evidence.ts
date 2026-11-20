
import type { ContrastSelectionReflectionItemV1, ProductionMistakeReflectionItemV1, ReflectionInputItemV1, SessionNoteReflectionItemV1 } from './reflection';

// Compile-time checks keep validators and the canonical union from drifting.
type _ValidatedBundleItems =
  | ProductionMistakeReflectionItemV1
  | SessionNoteReflectionItemV1
  | ContrastSelectionReflectionItemV1;
type _BundleUnionIsCovered =
  ReflectionInputItemV1 extends _ValidatedBundleItems
    ? _ValidatedBundleItems extends ReflectionInputItemV1
      ? true
      : never
    : never;
const bundleUnionIsCovered: _BundleUnionIsCovered = true;
void bundleUnionIsCovered;
