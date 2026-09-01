import type { PageviewTrigger } from '@syncline/protocol';

/**
 * Route-change detection.
 *
 * A single-page application navigates without a page load, so `load` events see one page and the
 * user sees five. The only way to know is to watch the History API, which means patching two
 * methods on an object the host application also owns — so the patch is installed once, records
 * what it replaced, and puts it back on uninstall. A page that mounts and unmounts the SDK (React
 * in development does exactly this) must not accumulate layers of wrappers.
 *
 * Deliberately not a `MutationObserver` or a polling loop on `location.href`: both would fire after
 * the fact, and the timestamp of a route change is the boundary the whole flow is built on.
 */

export interface NavigationTarget {
  history: Pick<History, 'pushState' | 'replaceState'>;
  location: Pick<Location, 'href'>;
  addEventListener: Window['addEventListener'];
  removeEventListener: Window['removeEventListener'];
}

export interface NavigationChange {
  trigger: PageviewTrigger;
  url: string;
}

/**
 * Calls back on every route change, and never for a navigation that did not move.
 *
 * Routers call `replaceState` with the URL they are already on — normalizing a trailing slash,
 * writing back a query parameter — and a flow full of duplicate entries is harder to read than no
 * flow at all. Comparing the resolved href is enough to drop those.
 */
export function installNavigationWatch(
  target: NavigationTarget,
  onChange: (change: NavigationChange) => void,
): () => void {
  let lastUrl = target.location.href;

  const emit = (trigger: PageviewTrigger) => {
    const url = target.location.href;
    if (url === lastUrl) return;
    lastUrl = url;
    onChange({ trigger, url });
  };

  const originalPush = target.history.pushState;
  const originalReplace = target.history.replaceState;

  // Applied with the original `this` so a host that also wraps these keeps working, and wrapped in
  // try/finally so a throw inside our own bookkeeping can never swallow the navigation itself.
  target.history.pushState = function patchedPushState(
    this: History,
    ...args: Parameters<History['pushState']>
  ) {
    const result = originalPush.apply(this, args);
    try {
      emit('pushState');
    } catch {
      /* never let instrumentation break a navigation */
    }
    return result;
  };

  target.history.replaceState = function patchedReplaceState(
    this: History,
    ...args: Parameters<History['replaceState']>
  ) {
    const result = originalReplace.apply(this, args);
    try {
      emit('replaceState');
    } catch {
      /* never let instrumentation break a navigation */
    }
    return result;
  };

  const onPopState = () => emit('popstate');
  const onHashChange = () => emit('hashchange');

  target.addEventListener('popstate', onPopState);
  target.addEventListener('hashchange', onHashChange);

  return () => {
    target.history.pushState = originalPush;
    target.history.replaceState = originalReplace;
    target.removeEventListener('popstate', onPopState);
    target.removeEventListener('hashchange', onHashChange);
  };
}
