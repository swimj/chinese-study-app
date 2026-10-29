import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowsProductionUnderProxyPolicy, isProductionProxied } from '../src/domain/production-proxy.ts';
import { productionProxyCases } from './helpers/production-proxy-cases.ts';

for (const scenario of productionProxyCases) test(`shared proxy policy: ${scenario.name}`, () => {
  const proxied = isProductionProxied({
    hasSharedPureCue: scenario.pure,
    hasSharedTargetedCue: scenario.targeted === 'shared',
  });
  assert.equal(proxied, scenario.proxied);
  assert.equal(allowsProductionUnderProxyPolicy({ proxied, hasUsableTargetedCue: scenario.targeted !== null }),
    scenario.skills.some(skill => skill === 'production'));
});
