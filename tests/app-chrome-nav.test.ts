import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, test } from 'node:test';
import { AppChrome, type AppPageKey } from '../src/components/AppChrome.tsx';

const noop = () => {};

function renderChrome(
  currentPage: AppPageKey,
  children: string | null = null,
  extras: {
    gettingStartedUnseen?: boolean;
    guideToStash?: boolean;
    serviceBanner?: { message: string } | null;
    sessionActive?: boolean;
    reflectionUnseenCount?: number;
    hasUnseenReflectionFailure?: boolean;
    reflectionGenerating?: boolean;
  } = {},
) {
  return renderToStaticMarkup(createElement(AppChrome, {
    currentPage,
    gettingStartedUnseen: extras.gettingStartedUnseen,
    guideToStash: extras.guideToStash,
    error: null,
    serviceBanner: extras.serviceBanner ?? null,
    sessionActive: extras.sessionActive ?? false,
    priorityPageLoading: false,
    reflectionPageLoading: false,
    contentPageLoading: false,
    reflectionUnseenCount: extras.reflectionUnseenCount ?? 0,
    hasUnseenReflectionFailure: extras.hasUnseenReflectionFailure ?? false,
    reflectionGenerating: extras.reflectionGenerating ?? false,
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
    assert.match(markup, />Feedback</);
    assert.match(markup, />Content Bin</);
    assert.match(markup, />About</);
    assert.doesNotMatch(markup, /class="app-nav-nested"/);
  });

  test('opens a nested slot only for Words, Feedback, and About', () => {
    assert.match(renderChrome('about'), /class="app-nav-nested"/);
    assert.match(renderChrome('priority'), /class="app-nav-nested"/);
    assert.match(renderChrome('reflections'), /class="app-nav-nested"/);
    assert.doesNotMatch(renderChrome('home'), /class="app-nav-nested"/);
    assert.doesNotMatch(renderChrome('content'), /class="app-nav-nested"/);
  });

  test('exposes the first-visit guide from Home without changing the active page', () => {
    const markup = renderChrome('home', null, { gettingStartedUnseen: true });
    assert.match(markup, /getting-started-attention/);
    assert.match(markup, /Getting Started/);
    assert.match(markup, /Start here/);
    assert.match(markup, /aria-current="page"><span>Home/);
    assert.doesNotMatch(renderChrome('home'), /getting-started-attention/);
    assert.doesNotMatch(renderChrome('about', null, { gettingStartedUnseen: true }), /getting-started-attention/);
  });

  test('guides toward Words after the guide, and clears the cue after Stash', () => {
    const markup = renderChrome('about', null, { guideToStash: true });
    assert.match(markup, /getting-started-attention[^]*?Words[^]*?Add to your stash/);
    assert.doesNotMatch(markup, /Start here/);
    assert.doesNotMatch(renderChrome('home'), /Add to your stash/);
  });

  test('keeps What’s New unread counts out of the About primary navigation', () => {
    assert.doesNotMatch(renderChrome('home'), /nav-tab-count-about/);
    assert.doesNotMatch(renderChrome('about'), /nav-tab-count-about/);
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
    assert.match(withHandler, /aria-label="Refresh feedback workspace from server"/);
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

  test('hides the Reflections unseen count while that tab is current', () => {
    const home = renderChrome('home', null, { reflectionUnseenCount: 2 });
    assert.match(home, /aria-label="Feedback, 2 new"/);
    assert.match(home, /class="nav-tab-count nav-tab-count-reflections">2</);

    const reflections = renderChrome('reflections', null, { reflectionUnseenCount: 2 });
    assert.doesNotMatch(reflections, /nav-tab-count/);
    assert.doesNotMatch(reflections, /Feedback, 2 new/);
  });

  test('shows a failure marker instead of the count, and hides it while Reflections is current', () => {
    const home = renderChrome('home', null, {
      reflectionUnseenCount: 4,
      hasUnseenReflectionFailure: true,
    });
    assert.match(home, /aria-label="Feedback, generation failed"/);
    assert.match(home, /class="nav-tab-alert"/);
    assert.doesNotMatch(home, /nav-tab-count/);

    const reflections = renderChrome('reflections', null, {
      reflectionUnseenCount: 4,
      hasUnseenReflectionFailure: true,
    });
    assert.doesNotMatch(reflections, /nav-tab-alert/);
    assert.doesNotMatch(reflections, /generation failed/);
    assert.doesNotMatch(reflections, /nav-tab-count/);
  });

  test('shows a generating spinner instead of the count, behind a failure marker, and hides it on Reflections', () => {
    const home = renderChrome('home', null, {
      reflectionUnseenCount: 4,
      reflectionGenerating: true,
    });
    assert.match(home, /aria-label="Feedback, generating"/);
    assert.match(home, /class="nav-tab-generating"/);
    assert.doesNotMatch(home, /nav-tab-count/);
    assert.doesNotMatch(home, /nav-tab-alert/);

    const failed = renderChrome('home', null, {
      reflectionUnseenCount: 4,
      reflectionGenerating: true,
      hasUnseenReflectionFailure: true,
    });
    assert.match(failed, /aria-label="Feedback, generation failed"/);
    assert.match(failed, /class="nav-tab-alert"/);
    assert.doesNotMatch(failed, /nav-tab-generating/);

    const reflections = renderChrome('reflections', null, {
      reflectionUnseenCount: 4,
      reflectionGenerating: true,
    });
    assert.doesNotMatch(reflections, /nav-tab-generating/);
    assert.doesNotMatch(reflections, /Feedback, generating/);
  });
});
