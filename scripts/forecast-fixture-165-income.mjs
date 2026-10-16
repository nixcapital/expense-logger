/**
 * Fixture for Forecast v2 with-income / 90-day positive hero (mockup 5).
 */
import { buildForecastFixture164, CHECKING, ts as ts164 } from './forecast-fixture-164.mjs';

export { CHECKING, CHASE } from './forecast-fixture-164.mjs';

export const FIXTURE_NOW = ts164(2026, 9, 16);

export function buildForecastFixture165Income() {
  return buildForecastFixture164({ withIncome: true, balance: 25000 });
}
