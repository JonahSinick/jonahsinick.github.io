/**
 * Own delayed callbacks for one gameplay lifetime.
 *
 * Cancelling the lifetime clears every outstanding native timer and advances a
 * generation token, so even a callback already queued by the event loop becomes
 * inert. New callbacks scheduled afterward belong to the new generation.
 */
export function createScheduler({
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let generation = 0;
  const pending = new Set();

  function schedule(callback, delay = 0) {
    if (typeof callback !== 'function')
      throw new TypeError('scheduled callback must be a function');
    const owner = generation;
    let handle;
    handle = setTimer(() => {
      pending.delete(handle);
      if (owner === generation) callback();
    }, delay);
    pending.add(handle);
    return handle;
  }

  function cancel(handle) {
    if (!pending.delete(handle)) return false;
    clearTimer(handle);
    return true;
  }

  function cancelAll() {
    generation++;
    for (const handle of pending) clearTimer(handle);
    pending.clear();
  }

  function state() {
    return { generation, pending: pending.size };
  }

  return { schedule, cancel, cancelAll, state };
}
