export function createBackHandler({ getContext, confirmDiscard, closeDialog, showToday }) {
  return () => {
    const context = getContext();
    if (!context.appVisible) return false;
    if (context.busy) return true;
    const dialog = context.dialogs.at(-1);
    if (dialog) {
      if (!dialog.dirty || confirmDiscard()) closeDialog(dialog.id);
      return true;
    }
    if (context.view !== 'today') {
      if (context.view === 'form' && context.formDirty && !confirmDiscard()) return true;
      showToday();
      return true;
    }
    return false;
  };
}
