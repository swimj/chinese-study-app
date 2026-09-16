import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, test } from 'node:test';
import { AppChrome, type AppPageKey } from '../src/components/AppChrome.tsx';

const noop = () => {};

function renderChrome(
  currentPage: AppPageKey,
  children: string | null = null,
  extras: { serviceBanner?: { message: string } | null; sessionActive?: boolean } = {},
) {
  return renderToStaticMarkup(createElement(AppChrome, {
    currentPage,
    error: null,
    serviceBanner: extras.serviceBanner ?? null,
    sessionActive: extras.sessionActive ?? false,
    priorityPageLoading: false,
    reflectionPageLoading: false,
    contentPageLoading: false,
    onOpenHomePage: noop,
    onOpenPriorityPage: noop,
    onOpenReflectionsPage: noop,
    onOpenContentPage: noop,
    onOpenAboutPage: noop,
  }, children));
}

describe('AppChrome primary navigation', () => {
  test('renders a left-gutter primary landmark with the five views and product name', () => {
    const markup = renderChrome('home');
    assert.match(markup, /aria-label="Primary"/);
    assert.match(markup, /class="navbar app-primary-nav"/);
    assert.match(markup, /class="nav-brand"/);
    assert.match(markup, /闲云无敌锤子/);
    assert.doesNotMatch(markup, /add french support/i);
    assert.doesNotMatch(markup, /v2\.3\.0/);
    assert.match(markup, />Home</);
    assert.match(markup, />Words</);
    assert.match(markup, />Reflections</);
    assert.match(markup, />Content Bin</);
    assert.match(markup, />About</);
    assert.doesNotMatch(markup, /class="app-nav-nested"/);
  });

  test('opens a nested slot only for Words, Reflections, and About', () => {
    assert.match(renderChrome('about'), /class="app-nav-nested"/);
    assert.match(renderChrome('priority'), /class="app-nav-nested"/);
    assert.match(renderChrome('reflections'), /class="app-nav-nested"/);
    assert.doesNotMatch(renderChrome('home'), /class="app-nav-nested"/);
    assert.doesNotMatch(renderChrome('content'), /class="app-nav-nested"/);
  });

  test('overlays a refresh control on Reflections only while that view is open', () => {
    const withHandler = renderToStaticMarkup(createElement(AppChrome, {
      currentPage: 'reflections',
      error: null,
      serviceBanner: null,
      sessionActive: false,
      priorityPageLoading: false,
      reflectionPageLoading: false,
      contentPageLoading: false,
      onOpenHomePage: noop,
      onOpenPriorityPage: noop,
      onOpenReflectionsPage: noop,
      onRefreshReflections: noop,
      onOpenContentPage: noop,
      onOpenAboutPage: noop,
    }));
    assert.match(withHandler, /class="reflections-nav-shell"/);
    assert.match(withHandler, /aria-label="Refresh reflection workspace from server"/);
    assert.match(withHandler, /class="reflections-nav-refresh"/);

    assert.doesNotMatch(renderChrome('reflections'), /class="reflections-nav-shell"/);
    assert.doesNotMatch(renderChrome('home'), /class="reflections-nav-refresh"/);
    assert.doesNotMatch(
      renderToStaticMarkup(createElement(AppChrome, {
        currentPage: 'home',
        error: null,
        serviceBanner: null,
        sessionActive: false,
        priorityPageLoading: false,
        reflectionPageLoading: false,
        contentPageLoading: false,
        onOpenHomePage: noop,
        onOpenPriorityPage: noop,
        onOpenReflectionsPage: noop,
        onRefreshReflections: noop,
        onOpenContentPage: noop,
        onOpenAboutPage: noop,
      })),
      /class="reflections-nav-refresh"/,
    );
  });

  test('shows a service banner outside an active session and hides it during one', () => {
    const posted = { message: 'Planned downtime tonight for upgrade' };
    assert.match(renderChrome('home', null, { serviceBanner: posted }), /class="service-banner"/);
    assert.match(renderChrome('home', null, { serviceBanner: posted }), /Planned downtime tonight for upgrade/);
    assert.match(renderChrome('priority', null, { serviceBanner: posted }), /class="service-banner"/);
    assert.doesNotMatch(
      renderChrome('home', null, { serviceBanner: posted, sessionActive: true }),
      /class="service-banner"/,
    );
    assert.doesNotMatch(renderChrome('home'), /class="service-banner"/);
  });
});
