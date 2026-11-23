/**
 * Block same-document Back/Forward before the router sees popstate.
 * A declined departure restores the current URL with a history entry; this
 * keeps the mounted form intact rather than trying to restore it after unmount.
 */
export function installHistoryGuard(allowDeparture: () => boolean, browser: Window = window) {
  let currentUrl = browser.location.href;
  let currentState = browser.history.state;
  const remember = () => {
    currentUrl = browser.location.href;
    currentState = browser.history.state;
  };
  const onPopState = (event: PopStateEvent) => {
    if (browser.location.href === currentUrl) return;
    if (allowDeparture()) { remember(); return; }
    event.preventDefault();
    event.stopImmediatePropagation();
    browser.history.pushState(currentState, "", currentUrl);
  };
  browser.addEventListener("popstate", onPopState, true);
  // Wouter dispatches these events for programmatic history changes.
  browser.addEventListener("pushState", remember);
  browser.addEventListener("replaceState", remember);
  return () => {
    browser.removeEventListener("popstate", onPopState, true);
    browser.removeEventListener("pushState", remember);
    browser.removeEventListener("replaceState", remember);
  };
}