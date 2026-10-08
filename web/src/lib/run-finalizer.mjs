/**
 * Release a run's resources after both the worker and its follow-up work finish.
 *
 * Sending SIGTERM does not mean the worker has stopped writing. Its `close`
 * event also waits for stdio to close, so it is the point at which a canceled
 * run can release the tracker-delete guard. The returned function can be called
 * earlier on cancellation, or later after PDF rendering and marking complete.
 *
 * Its `workerGone()` stands in for a `close` that terminateCliRun gave up
 * waiting for, so a stuck descendant cannot hold the guard forever.
 *
 * @param {{ once: (event: string, listener: () => void) => unknown }} child
 * @param {() => void} release
 * @returns {(() => void) & { workerGone: () => void }}
 */
export function createRunFinalizer(child, release) {
  let workerClosed = false;
  let runFinished = false;
  let released = false;

  const releaseIfFinished = () => {
    if (workerClosed && runFinished && !released) {
      released = true;
      release();
    }
  };

  const workerGone = () => {
    workerClosed = true;
    releaseIfFinished();
  };
  child.once("close", workerGone);

  return Object.assign(
    () => {
      runFinished = true;
      releaseIfFinished();
    },
    { workerGone },
  );
}
