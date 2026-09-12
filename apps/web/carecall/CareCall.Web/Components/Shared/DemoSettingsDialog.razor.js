export function open(dialog, reference) {
    if (!dialog?.isConnected) return;
    const trigger = document.activeElement;
    const cancel = event => {
        event.preventDefault();
        if (dialog.dataset.saving !== "true") {
            reference.invokeMethodAsync("CancelAsync").catch(() => {
                // The Blazor circuit may have disconnected.
            });
        }
    };
    // Blazor may remove the element before .NET disposal runs.
    const observer = new MutationObserver(() => {
        if (dialog.isConnected) return;
        observer.disconnect();
        dialog.removeEventListener("cancel", cancel);
        dialog.close();
        if (trigger instanceof HTMLElement && trigger.isConnected) {
            trigger.focus();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    dialog.addEventListener("cancel", cancel);
    dialog.showModal();
}
