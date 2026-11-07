import { shouldPromptAfterControllerChange } from "./lib/appUpdate";

const UPDATE_CHECK_MS = 60_000;

/** Listen for a new service worker taking control. Never reloads the page. */
export function startUpdateWatch(onUpdate: () => void): () => void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return () => undefined;

  const hadController = shouldPromptAfterControllerChange(Boolean(navigator.serviceWorker.controller));
  const onChange = () => {
    if (!hadController) return;
    onUpdate();
  };
  navigator.serviceWorker.addEventListener("controllerchange", onChange);

  let timer = 0;
  const check = () => {
    void navigator.serviceWorker.getRegistration().then((registration) => {
      if (!registration) return;
      if (registration.installing) return;
      void registration.update();
    });
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") check();
  };
  timer = window.setInterval(check, UPDATE_CHECK_MS);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("load", check);

  return () => {
    navigator.serviceWorker.removeEventListener("controllerchange", onChange);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("load", check);
    window.clearInterval(timer);
  };
}
