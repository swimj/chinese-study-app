const state = {
  runs: [],
  fixtures: [],
  warnings: [],
  selectedRunIds: [],
  artifacts: new Map(),
  selectedModelNames: [],
  initializedFromUrl: false,
  comparisonRendered: false,
};

const elements = {
  fixtureFilter: document.querySelector('#fixture-filter'),
  modelFilter: document.querySelector('#model-filter'),
  modelFilterSummary: document.querySelector('#model-filter-summary'),
  modelFilterOptions: document.querySelector('#model-filter-options'),
  promptFilter: document.querySelector('#prompt-filter'),
  statusFilter: document.querySelector('#status-filter'),
  autoRefresh: document.querySelector('#auto-refresh'),
  refreshButton: document.querySelector('#refresh-button'),
  clearSelection: document.querySelector('#clear-selection'),
  runList: document.querySelector('#run-list'),
  runCount: document.querySelector('#run-count'),
  selectionCount: document.querySelector('#selection-count'),
  indexStatus: document.querySelector('#index-status'),
  scanWarnings: document.querySelector('#scan-warnings'),
  comparisonPane: document.querySelector('#comparison-pane'),
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function basename(filePath) {
  return String(filePath).split(/[\\/]/).pop() || filePath;
}

function shortHash(hash) {
  return String(hash).slice(0, 8);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(date);
}

function formatTokens(value) {
  return typeof value === 'number' ? value.toLocaleString() : '—';
}

function formatEstimatedCost(estimatedCost) {
  if (!estimatedCost) return '—';
  return `${(estimatedCost.usd * 100).toFixed(1)}¢`;
}

function formatPricing(estimatedCost) {
  if (!estimatedCost) return 'Pricing unavailable';
  const pricing = estimatedCost.pricing;
  return `$${pricing.inputPerMillionUsd}/$${pricing.cachedInputPerMillionUsd}/$${pricing.outputPerMillionUsd} per 1M (input/cached/output)`;
}

function promptKey(run) {
  return run.systemPromptSha256;
}

function promptLabel(run) {
  return `${basename(run.systemPromptFile)} · ${shortHash(run.systemPromptSha256)}`;
}

function fixtureTitle(fixtureId) {
  return state.fixtures.find((fixture) => fixture.fixtureId === fixtureId)?.title ?? fixtureId;
}

function runIdentity(run) {
  return `<div class="run-identity"><strong>${escapeHtml(run.requestedModel)}</strong><span>${escapeHtml(promptLabel(run))}</span><span>${escapeHtml(formatDate(run.startedAt))} · ${escapeHtml(run.runId.slice(0, 8))}</span></div>`;
}

function statusMarkup(status) {
  return `<span class="status status-${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function tagsMarkup(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return '<span class="muted">none</span>';
  return tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('');
}

function setSelectOptions(select, options, emptyLabel) {
  const current = select.value;
  select.innerHTML = `<option value="">${escapeHtml(emptyLabel)}</option>${options
    .map(({ value, label }) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`)
    .join('')}`;
  if (options.some((option) => option.value === current)) select.value = current;
}

function renderModelFilterOptions(models) {
  const availableModels = new Set(models);
  state.selectedModelNames = state.selectedModelNames.filter((model) => availableModels.has(model));
  const selectedModels = new Set(state.selectedModelNames);
  elements.modelFilterSummary.textContent = selectedModels.size === 0 ? 'All models' : `${selectedModels.size} selected`;
  elements.modelFilterOptions.innerHTML = [
    `<label class="model-filter-option model-filter-option-all"><input type="checkbox" data-model-filter-all ${selectedModels.size === 0 ? 'checked' : ''} /> All models</label>`,
    ...models.map((model) => `<label class="model-filter-option"><input type="checkbox" data-model-filter="${escapeHtml(model)}" ${selectedModels.has(model) ? 'checked' : ''} /> ${escapeHtml(model)}</label>`),
  ].join('');
}

function refreshFilterOptions() {
  const unique = (values) => [...new Set(values)].sort((left, right) => left.localeCompare(right));
  setSelectOptions(elements.fixtureFilter, unique(state.runs.map((run) => run.fixtureId)).map((value) => ({ value, label: fixtureTitle(value) })), 'All fixtures');
  renderModelFilterOptions(unique(state.runs.map((run) => run.requestedModel)));
  const prompts = new Map();
  for (const run of state.runs) prompts.set(promptKey(run), promptLabel(run));
  setSelectOptions(elements.promptFilter, [...prompts.entries()].map(([value, label]) => ({ value, label })), 'All prompt versions');
  setSelectOptions(elements.statusFilter, unique(state.runs.map((run) => run.currentValidation.status)).map((value) => ({ value, label: value })), 'All statuses');
}

function filteredRuns() {
  const selectedModels = new Set(state.selectedModelNames);
  return state.runs.filter((run) => {
    if (elements.fixtureFilter.value && run.fixtureId !== elements.fixtureFilter.value) return false;
    if (selectedModels.size > 0 && !selectedModels.has(run.requestedModel)) return false;
    if (elements.promptFilter.value && promptKey(run) !== elements.promptFilter.value) return false;
    if (elements.statusFilter.value && run.currentValidation.status !== elements.statusFilter.value) return false;
    return true;
  });
}

function renderWarnings() {
  if (state.warnings.length === 0) {
    elements.scanWarnings.hidden = true;
    return;
  }
  elements.scanWarnings.hidden = false;
  elements.scanWarnings.textContent = `${state.warnings.length} JSON file${state.warnings.length === 1 ? '' : 's'} could not be indexed. See the server output or API index for details.`;
}

function renderRunList() {
  const runs = filteredRuns();
  elements.runCount.textContent = `(${runs.length}/${state.runs.length})`;
  elements.selectionCount.textContent = `${state.selectedRunIds.length} selected`;
  if (runs.length === 0) {
    elements.runList.innerHTML = '<div class="no-runs">No artifacts match these filters.</div>';
    return;
  }
  elements.runList.innerHTML = runs.map((run) => {
    const selected = state.selectedRunIds.includes(run.runId);
    const total = run.usage?.totalTokens;
    return `<div class="run-card${selected ? ' selected' : ''}">
      <label class="run-card-selection">
        <input type="checkbox" data-run-id="${escapeHtml(run.runId)}" ${selected ? 'checked' : ''} />
        <span>
          <span class="run-model"><span>${escapeHtml(run.requestedModel)}</span><span class="run-provider">${escapeHtml(run.provider)}</span></span>
          <span class="run-fixture">${escapeHtml(fixtureTitle(run.fixtureId))}</span>
          <span class="run-meta">
            <span class="run-prompt">${escapeHtml(promptLabel(run))}</span>
            <span>${escapeHtml(formatDate(run.startedAt))}</span>
            ${statusMarkup(run.currentValidation.status)}
            <span>${escapeHtml(formatTokens(total))} tokens</span>
            <span title="${escapeHtml(formatPricing(run.estimatedCost))}">Est. ${escapeHtml(formatEstimatedCost(run.estimatedCost))}</span>
          </span>
        </span>
      </label>
      <button class="delete-run-button" type="button" data-delete-run-id="${escapeHtml(run.runId)}" aria-label="Delete ${escapeHtml(run.requestedModel)} run ${escapeHtml(run.runId.slice(0, 8))}">Delete</button>
    </div>`;
  }).join('');
}

function updateSelectionUrl() {
  const url = new URL(window.location.href);
  if (state.selectedRunIds.length > 0) url.searchParams.set('runs', state.selectedRunIds.join(','));
  else url.searchParams.delete('runs');
  history.replaceState(null, '', url);
}

async function fetchArtifact(runId) {
  if (state.artifacts.has(runId)) return state.artifacts.get(runId);
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
  if (!response.ok) throw new Error(`Could not load run ${runId}: HTTP ${response.status}`);
  const artifact = await response.json();
  state.artifacts.set(runId, artifact);
  return artifact;
}

function responseResult(artifact) {
  if (artifact.response.parsedResult) return artifact.response.parsedResult;
  if (!artifact.response.rawText) return null;
  try {
    return JSON.parse(artifact.response.rawText);
  } catch {
    return null;
  }
}

function resultForItem(artifact, itemId) {
  return responseResult(artifact)?.itemResults?.find((item) => item.itemId === itemId) ?? null;
}

function failureMarkup(artifact) {
  const run = state.runs.find((candidate) => candidate.runId === artifact.runId);
  const validation = run.currentValidation;
  return `<div class="error-text">${escapeHtml(validation.status)}${validation.validationErrors.length ? `: ${escapeHtml(validation.validationErrors.join(' · '))}` : ''}</div>`;
}

function renderRunSummary(artifacts) {
  const rows = artifacts.map((artifact) => {
    const run = state.runs.find((candidate) => candidate.runId === artifact.runId);
    const usage = artifact.response.usage;
    return `<tr>
      <td>${runIdentity(run)}</td>
      <td>${escapeHtml(run.provider)}</td>
      <td>${statusMarkup(run.currentValidation.status)}</td>
      <td>${escapeHtml(`${run.durationMs.toLocaleString()} ms`)}</td>
      <td>${escapeHtml(formatTokens(usage?.inputTokens))}</td>
      <td>${escapeHtml(formatTokens(usage?.cachedInputTokens))}</td>
      <td>${escapeHtml(formatTokens(usage?.outputTokens))}</td>
      <td>${escapeHtml(formatTokens(usage?.reasoningTokens))}</td>
      <td>${escapeHtml(formatTokens(usage?.totalTokens))}</td>
      <td title="${escapeHtml(formatPricing(run.estimatedCost))}">${escapeHtml(formatEstimatedCost(run.estimatedCost))}</td>
    </tr>`;
  }).join('');
  return `<div class="section"><h3>Run summary</h3><div class="table-wrap"><table>
    <thead><tr><th>Run</th><th>Provider</th><th>Status</th><th>Latency</th><th>Input</th><th>Cached</th><th>Output</th><th>Reasoning</th><th>Total</th><th>Est. cost</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div></div>`;
}

function validationDetailsMarkup(status, errors, schemaHash) {
  const errorList = Array.isArray(errors) && errors.length > 0
    ? `<ul>${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ul>`
    : '<p class="muted">No validation errors.</p>';
  return `${statusMarkup(status)}<div class="muted">schema ${escapeHtml(shortHash(schemaHash))}</div>${errorList}`;
}

function renderValidationDetails(artifacts) {
  const rows = artifacts.map((artifact) => {
    const run = state.runs.find((candidate) => candidate.runId === artifact.runId);
    return `<tr>
      <td>${runIdentity(run)}</td>
      <td>${validationDetailsMarkup(run.currentValidation.status, run.currentValidation.validationErrors, run.currentValidation.outputSchemaSha256)}</td>
    </tr>`;
  }).join('');
  return `<div class="section"><h3>Validation</h3><p class="muted">Validation is recalculated from raw model text against the current contract when the artifact index is read.</p><div class="table-wrap"><table>
    <thead><tr><th>Run</th><th>Validation</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div></div>`;
}

function renderResponseSummaries(artifacts) {
  const rows = artifacts.map((artifact) => {
    const run = state.runs.find((candidate) => candidate.runId === artifact.runId);
    const content = responseResult(artifact)?.summary;
    return `<tr><td>${runIdentity(run)}</td><td>${content ? escapeHtml(content) : '<span class="muted">No session summary emitted.</span>'}</td></tr>`;
  }).join('');
  return `<div class="section"><h3>Response summaries</h3><table><thead><tr><th>Run</th><th>Summary</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderItem(itemId, artifacts) {
  const diagnosisRows = artifacts.map((artifact) => {
    const run = state.runs.find((candidate) => candidate.runId === artifact.runId);
    const result = resultForItem(artifact, itemId);
    if (!result) return `<tr><td>${runIdentity(run)}</td><td colspan="4">${failureMarkup(artifact)}</td></tr>`;
    return `<tr>
      <td>${runIdentity(run)}</td>
      <td>${result.uncertain ? 'yes' : 'no'}</td>
      <td>${tagsMarkup(result.diagnosisTags)}</td>
      <td>${escapeHtml(result.observation)}</td>
      <td>${tagsMarkup(result.proposals.map((proposal) => proposal.operation.kind))}</td>
    </tr>`;
  }).join('');

  const explanations = artifacts.map((artifact) => {
    const run = state.runs.find((candidate) => candidate.runId === artifact.runId);
    const result = resultForItem(artifact, itemId);
    return `<tr><td>${runIdentity(run)}</td><td>${result?.learnerExplanation ? escapeHtml(result.learnerExplanation) : '<span class="muted">none</span>'}</td></tr>`;
  }).join('');

  const proposals = artifacts.map((artifact) => {
    const run = state.runs.find((candidate) => candidate.runId === artifact.runId);
    const result = resultForItem(artifact, itemId);
    let body = '<p class="muted">No proposals.</p>';
    if (!result) body = failureMarkup(artifact);
    else if (result.proposals.length > 0) {
      body = result.proposals.map((proposal) => `<div class="proposal">
        <div class="proposal-kind">${escapeHtml(proposal.operation.kind)}</div>
        <p>${escapeHtml(proposal.rationale)}</p>
        <details><summary>Operation payload</summary><pre>${escapeHtml(JSON.stringify(proposal.operation, null, 2))}</pre></details>
      </div>`).join('');
    }
    return `<div class="model-panel">${runIdentity(run)}${body}</div>`;
  }).join('');

  const questionRows = artifacts.flatMap((artifact) => {
    const run = state.runs.find((candidate) => candidate.runId === artifact.runId);
    const result = resultForItem(artifact, itemId);
    const questions = result?.questions ?? [];
    if (questions.length === 0) return [`<tr><td>${runIdentity(run)}</td><td class="muted">none</td><td>—</td></tr>`];
    return questions.map((question) => `<tr><td>${runIdentity(run)}</td><td>${escapeHtml(question.question)}</td><td>${escapeHtml(question.reason)}</td></tr>`);
  }).join('');

  const needRows = artifacts.flatMap((artifact) => {
    const run = state.runs.find((candidate) => candidate.runId === artifact.runId);
    const result = resultForItem(artifact, itemId);
    const unhandledNeeds = result?.unhandledNeeds ?? [];
    if (unhandledNeeds.length === 0) return [`<tr><td>${runIdentity(run)}</td><td class="muted">none</td><td>—</td></tr>`];
    return unhandledNeeds.map((need) => `<tr><td>${runIdentity(run)}</td><td>${escapeHtml(need.description)}</td><td>${escapeHtml(need.whyExistingHandlesDoNotFit)}</td></tr>`);
  }).join('');

  return `<div class="section">
    <h3>Item <span class="tag">${escapeHtml(itemId)}</span></h3>
    <h4>Diagnosis and observation</h4>
    <div class="table-wrap"><table><thead><tr><th>Run</th><th>Uncertain</th><th>Diagnosis tags</th><th>Observation</th><th>Handles</th></tr></thead><tbody>${diagnosisRows}</tbody></table></div>
    <h3>Learner explanations</h3>
    <table><thead><tr><th>Run</th><th>Explanation</th></tr></thead><tbody>${explanations}</tbody></table>
    <h3>Proposed handles</h3><div class="comparison-grid">${proposals}</div>
    <h3>Questions</h3><table><thead><tr><th>Run</th><th>Question</th><th>Reason</th></tr></thead><tbody>${questionRows}</tbody></table>
    <h3>Unhandled needs</h3><table><thead><tr><th>Run</th><th>Need</th><th>Why existing handles do not fit</th></tr></thead><tbody>${needRows}</tbody></table>
  </div>`;
}

function renderEvaluation(fixture) {
  if (!fixture) return '';
  const evaluation = fixture.evaluation;
  const profiles = evaluation.acceptableProposalProfiles.map((profile) => `<li>${escapeHtml(profile.description)} <span class="muted">Required: ${escapeHtml(profile.requiredKinds.join(', ') || 'none')}; allowed: ${escapeHtml(profile.allowedKinds.join(', ') || 'none')}.</span></li>`).join('');
  const required = evaluation.requiredJudgments.map((judgment) => `<li>${escapeHtml(judgment)}</li>`).join('');
  const forbidden = evaluation.forbiddenJudgments.map((judgment) => `<li>${escapeHtml(judgment)}</li>`).join('');
  return `<div class="section evaluation">
    <h3>Local evaluation guide</h3>
    <p class="evaluation-intro">Fixture-only guidance. It was not sent to any model.</p>
    <p>${tagsMarkup(evaluation.requiredDiagnosisTags)} <span class="muted">required diagnoses</span></p>
    <p>${tagsMarkup(evaluation.forbiddenDiagnosisTags)} <span class="muted">forbidden diagnoses</span></p>
    <h4>Acceptable proposal profiles</h4><ul>${profiles || '<li>none</li>'}</ul>
    <div class="judgment-columns"><div><h4>Critical judgments</h4><ul>${required || '<li>none</li>'}</ul></div><div><h4>Forbidden judgments</h4><ul>${forbidden || '<li>none</li>'}</ul></div></div>
  </div>`;
}

function renderRawArtifacts(artifacts) {
  const panels = artifacts.map((artifact) => {
    const run = state.runs.find((candidate) => candidate.runId === artifact.runId);
    return `<div class="model-panel">${runIdentity(run)}<details><summary>Full raw artifact</summary><pre>${escapeHtml(JSON.stringify(artifact, null, 2))}</pre></details></div>`;
  }).join('');
  return `<div class="section"><h3>Raw artifacts</h3><div class="comparison-grid">${panels}</div></div>`;
}

async function renderComparison() {
  state.comparisonRendered = true;
  elements.selectionCount.textContent = `${state.selectedRunIds.length} selected`;
  if (state.selectedRunIds.length === 0) {
    elements.comparisonPane.innerHTML = `<div class="empty-state"><div class="empty-mark">↗</div><h2>Build a comparison incrementally</h2><p>Select runs from the library. New artifacts will appear without regenerating a report.</p></div>`;
    return;
  }
  elements.comparisonPane.innerHTML = '<div class="loading">Loading selected artifacts…</div>';
  try {
    const artifacts = await Promise.all(state.selectedRunIds.map(fetchArtifact));
    const fixtureId = artifacts[0].fixtureId;
    const fixture = state.fixtures.find((candidate) => candidate.fixtureId === fixtureId);
    const itemIds = [...new Set(artifacts.flatMap((artifact) => artifact.inputBundle.items.map((item) => item.itemId)))];
    const promptCount = new Set(artifacts.map((artifact) => artifact.request.systemPromptSha256)).size;
    const header = `<div class="comparison-header"><div><p class="eyebrow">Selected artifact view</p><h2>${escapeHtml(fixtureTitle(fixtureId))}</h2><p>${artifacts.length} run${artifacts.length === 1 ? '' : 's'} · ${promptCount} prompt version${promptCount === 1 ? '' : 's'}</p></div><div class="comparison-actions"><button class="primary-button" id="copy-link" type="button">Copy comparison link</button></div></div>`;
    const promptNotice = promptCount > 1 ? '<div class="notice">This selection spans multiple prompt hashes. That is useful for prompt iteration; prompt identities remain visible on every row.</div>' : '';
    elements.comparisonPane.innerHTML = [
      header,
      promptNotice,
      renderRunSummary(artifacts),
      renderValidationDetails(artifacts),
      renderResponseSummaries(artifacts),
      ...itemIds.map((itemId) => renderItem(itemId, artifacts)),
      renderEvaluation(fixture),
      renderRawArtifacts(artifacts),
    ].join('');
    document.querySelector('#copy-link')?.addEventListener('click', async (event) => {
      await navigator.clipboard.writeText(window.location.href);
      event.currentTarget.textContent = 'Copied';
      setTimeout(() => { event.currentTarget.textContent = 'Copy comparison link'; }, 1_200);
    });
  } catch (error) {
    elements.comparisonPane.innerHTML = `<div class="notice error-text">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
  }
}

async function toggleRun(runId, checked) {
  const run = state.runs.find((candidate) => candidate.runId === runId);
  if (!run) return;
  if (checked) {
    const selectedRuns = state.selectedRunIds.map((id) => state.runs.find((candidate) => candidate.runId === id)).filter(Boolean);
    if (selectedRuns.some((selected) => selected.fixtureId !== run.fixtureId)) state.selectedRunIds = [];
    if (!state.selectedRunIds.includes(runId)) state.selectedRunIds.push(runId);
  } else {
    state.selectedRunIds = state.selectedRunIds.filter((id) => id !== runId);
  }
  updateSelectionUrl();
  renderRunList();
  await renderComparison();
}

async function deleteRun(runId, button) {
  const run = state.runs.find((candidate) => candidate.runId === runId);
  if (!run) return;
  const confirmed = window.confirm([
    'Move this run artifact to .trash?',
    '',
    `${run.requestedModel} · ${fixtureTitle(run.fixtureId)}`,
    `${formatDate(run.startedAt)} · ${run.runId}`,
    run.relativePath,
  ].join('\n'));
  if (!confirmed) return;

  button.disabled = true;
  try {
    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, { method: 'DELETE' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? `Delete request failed: HTTP ${response.status}`);

    state.selectedRunIds = state.selectedRunIds.filter((id) => id !== runId);
    state.artifacts.delete(runId);
    state.comparisonRendered = false;
    updateSelectionUrl();
    await refreshIndex();
  } catch (error) {
    window.alert(error instanceof Error ? error.message : String(error));
    button.disabled = false;
  }
}

async function refreshIndex() {
  elements.indexStatus.textContent = 'Indexing artifacts…';
  try {
    const previousSelection = state.selectedRunIds.join(',');
    const response = await fetch('/api/index');
    if (!response.ok) throw new Error(`Index request failed: HTTP ${response.status}`);
    const payload = await response.json();
    state.runs = payload.runs;
    state.fixtures = payload.fixtures;
    state.warnings = payload.warnings;
    if (!state.initializedFromUrl) {
      const requested = new URLSearchParams(window.location.search).get('runs')?.split(',').filter(Boolean) ?? [];
      const available = new Set(state.runs.map((run) => run.runId));
      state.selectedRunIds = requested.filter((runId) => available.has(runId));
      state.initializedFromUrl = true;
    } else {
      const available = new Set(state.runs.map((run) => run.runId));
      state.selectedRunIds = state.selectedRunIds.filter((runId) => available.has(runId));
    }
    refreshFilterOptions();
    renderWarnings();
    renderRunList();
    if (!state.comparisonRendered || previousSelection !== state.selectedRunIds.join(',')) {
      await renderComparison();
    }
    elements.indexStatus.textContent = `Indexed ${state.runs.length} runs · ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    elements.indexStatus.textContent = error instanceof Error ? error.message : String(error);
  }
}

for (const filter of [elements.fixtureFilter, elements.promptFilter, elements.statusFilter]) {
  filter.addEventListener('change', renderRunList);
}
elements.modelFilterOptions.addEventListener('change', (event) => {
  const input = event.target.closest('input[data-model-filter], input[data-model-filter-all]');
  if (!input) return;
  if (input.hasAttribute('data-model-filter-all')) state.selectedModelNames = [];
  else {
    const selectedModels = new Set(state.selectedModelNames);
    if (input.checked) selectedModels.add(input.dataset.modelFilter);
    else selectedModels.delete(input.dataset.modelFilter);
    state.selectedModelNames = [...selectedModels];
  }
  renderModelFilterOptions([...new Set(state.runs.map((run) => run.requestedModel))].sort((left, right) => left.localeCompare(right)));
  renderRunList();
});
elements.refreshButton.addEventListener('click', refreshIndex);
elements.clearSelection.addEventListener('click', async () => {
  state.selectedRunIds = [];
  updateSelectionUrl();
  renderRunList();
  await renderComparison();
});
elements.runList.addEventListener('change', (event) => {
  const checkbox = event.target.closest('input[data-run-id]');
  if (checkbox) void toggleRun(checkbox.dataset.runId, checkbox.checked);
});
elements.runList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-delete-run-id]');
  if (button) void deleteRun(button.dataset.deleteRunId, button);
});

setInterval(() => {
  if (elements.autoRefresh.checked) void refreshIndex();
}, 5_000);

void refreshIndex();
