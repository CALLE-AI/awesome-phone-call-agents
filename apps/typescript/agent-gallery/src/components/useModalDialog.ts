import { useEffect, useRef, type RefObject } from "react";

const focusableSelector = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

/** Keeps keyboard focus inside a modal and restores the invoking control on close. */
export function useModalDialog(
  panelRef: RefObject<HTMLElement | null>,
  initialFocusRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  closeOnEscape = true,
) {
  const closeRef = useRef(onClose);
  const closeOnEscapeRef = useRef(closeOnEscape);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => { closeOnEscapeRef.current = closeOnEscape; }, [closeOnEscape]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const backdrop = panelRef.current?.parentElement;
    const background = backdrop?.parentElement
      ? [...backdrop.parentElement.children].filter((element): element is HTMLElement => element instanceof HTMLElement && element !== backdrop)
      : [];
    const backgroundState = background.map((element) => ({ element, inert: element.inert, ariaHidden: element.getAttribute("aria-hidden") }));
    for (const element of background) {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    }
    document.body.style.overflow = "hidden";
    initialFocusRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && closeOnEscapeRef.current) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])]
        .filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        initialFocusRef.current?.focus();
      } else if (event.shiftKey && (document.activeElement === first || !panelRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panelRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      for (const { element, inert, ariaHidden } of backgroundState) {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
      previouslyFocused?.focus();
    };
  }, [initialFocusRef, panelRef]);
}
