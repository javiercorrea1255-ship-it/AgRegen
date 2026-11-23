import { describe, expect, it, vi } from "vitest";
import { installHistoryGuard } from "../client/src/lib/guard-history";

function browserFixture() {
  const browser = new EventTarget() as any;
  browser.location = { href: "https://fixture.invalid/parcel/test?tab=soil" };
  browser.history = {
    state: { fixture: true },
    pushState: vi.fn((state, _title, url) => {
      browser.location.href = url;
      browser.history.state = state;
      browser.dispatchEvent(new Event("pushState"));
    }),
  };
  return browser;
}
describe("Soil-health history navigation guard", () => {
  it.each(["/dashboard", "/parcel/other"])("keeps the form mounted when Back/Forward to %s is declined", destination => {
    const browser = browserFixture();
    const stop = installHistoryGuard(() => false, browser);
    const router = vi.fn();
    browser.addEventListener("popstate", router);
    browser.location.href = `https://fixture.invalid${destination}`;
    browser.dispatchEvent(new Event("popstate", { cancelable: true }));
    expect(router).not.toHaveBeenCalled();
    expect(browser.location.href).toBe("https://fixture.invalid/parcel/test?tab=soil");
    stop();
  });
  it("permits confirmed departure and does not leave a guard after unmount", () => {
    const browser = browserFixture();
    const stop = installHistoryGuard(() => true, browser);
    const router = vi.fn();
    browser.addEventListener("popstate", router);
    browser.location.href = "https://fixture.invalid/dashboard";
    browser.dispatchEvent(new Event("popstate"));
    expect(router).toHaveBeenCalledOnce();
    expect(browser.history.pushState).not.toHaveBeenCalled();
    stop();
  });
  it("blocks a pending-save departure without requiring a dirty draft", () => {
    const browser = browserFixture();
    let busy = true;
    const allow = vi.fn(() => !busy);
    const stop = installHistoryGuard(allow, browser);
    browser.location.href = "https://fixture.invalid/dashboard";
    browser.dispatchEvent(new Event("popstate"));
    expect(browser.history.pushState).toHaveBeenCalledOnce();
    busy = false;
    browser.location.href = "https://fixture.invalid/dashboard";
    browser.dispatchEvent(new Event("popstate"));
    expect(browser.history.pushState).toHaveBeenCalledOnce();
    stop();
  });
});