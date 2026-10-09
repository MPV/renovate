import type { RangeConfig } from '../types.ts';
import { getRangeStrategy } from './index.ts';

describe('modules/manager/apm/range', () => {
  it.each`
    rangeStrategy | currentValue        | expected
    ${'auto'}     | ${'^1.2.0'}         | ${'replace'}
    ${'auto'}     | ${'v1.2.0'}         | ${'replace'}
    ${'auto'}     | ${undefined}        | ${'replace'}
    ${'auto'}     | ${'>=1.0.0 <2.0.0'} | ${'widen'}
    ${'widen'}    | ${'^1.2.0'}         | ${'replace'}
    ${'widen'}    | ${'>=1.0.0 <2.0.0'} | ${'widen'}
    ${'replace'}  | ${'>=1.0.0 <2.0.0'} | ${'replace'}
    ${'bump'}     | ${'^1.2.0'}         | ${'bump'}
    ${'pin'}      | ${'^1.2.0'}         | ${'pin'}
  `(
    'returns $expected for $rangeStrategy and $currentValue',
    ({ rangeStrategy, currentValue, expected }) => {
      const config: RangeConfig = { rangeStrategy, currentValue };
      expect(getRangeStrategy(config)).toBe(expected);
    },
  );
});
