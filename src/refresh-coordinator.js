export function createRefreshCoordinator() {
  const pending = new WeakMap();
  return (repository, work) => {
    if (pending.has(repository)) return pending.get(repository);
    const task = Promise.resolve().then(work).finally(() => {
      if (pending.get(repository) === task) pending.delete(repository);
    });
    pending.set(repository, task);
    return task;
  };
}
