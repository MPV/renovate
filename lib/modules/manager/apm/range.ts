import type { RangeStrategy } from '../../../types/index.ts';
import { regEx } from '../../../util/regex.ts';
import type { RangeConfig } from '../types.ts';

/**
 * APM ranges are space-separated comparators with no `||`. `widen` would join a
 * new range to a single comparator with `||`, which APM can't parse, so use
 * `replace` there; for a compound range (`>=1.0.0 <2.0.0`) `widen` raises the
 * upper bound and keeps the lower one, which `replace` would drop.
 */
export function getRangeStrategy({
  currentValue,
  rangeStrategy,
}: RangeConfig): RangeStrategy {
  if (rangeStrategy !== 'auto' && rangeStrategy !== 'widen') {
    return rangeStrategy!;
  }
  const isComplexRange =
    !!currentValue && currentValue.trim().split(regEx(/\s+/)).length > 1;
  return isComplexRange ? 'widen' : 'replace';
}
