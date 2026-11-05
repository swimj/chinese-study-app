import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OPERATOR_TABS, isOperatorPath, operatorPath, operatorTabFromPath } from '../src/features/operator/routes.ts';
import { OperatorShell } from '../src/components/OperatorShell.tsx';
test('each operator route is independent of learner hashes and unknown tabs stay operator-scoped',()=>{
  for(const tab of OPERATOR_TABS){assert.equal(isOperatorPath(operatorPath(tab.id)),true);assert.equal(operatorTabFromPath(operatorPath(tab.id)),tab.id);}
  assert.equal(operatorTabFromPath('/operator'),'usage');assert.equal(operatorTabFromPath('/operator/'),'usage');
  assert.equal(operatorTabFromPath('/operator/missing'),null);assert.equal(isOperatorPath('/operator/missing'),true);
  assert.equal(isOperatorPath('/operators'),false);assert.equal(isOperatorPath('/'),false);assert.equal(isOperatorPath('/#operator-usage'),false);
});
test('operator shell has route links and full-page study return without learner navigation',()=>{
  const html=renderToStaticMarkup(React.createElement(OperatorShell,{tab:'improvement',children:'Operator content'}));
  assert.match(html,/href="\/operator\/improvement" aria-current="page"/);assert.match(html,/href="\/">Return to study/);
  assert.doesNotMatch(html,/Getting Started|Content Bin|app-sidebar|#operator-/);
});
