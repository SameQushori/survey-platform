import { describe, expect, it, vi } from 'vitest';
import { RevisionSaveQueue } from '../src/vecta/revisionQueue';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('RevisionSaveQueue', () => {
  it('waits for the previous save and uses its returned revision', async () => {
    const queue = new RevisionSaveQueue(4);
    const first = deferred<{ revision: number }>();
    const second = deferred<{ revision: number }>();
    const save = vi
      .fn<(revision: number) => Promise<{ revision: number }>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const firstResult = queue.enqueue(save);
    const secondResult = queue.enqueue(save);
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenNthCalledWith(1, 4);

    first.resolve({ revision: 5 });
    await expect(firstResult).resolves.toEqual({ revision: 5 });
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenNthCalledWith(2, 5);

    second.resolve({ revision: 6 });
    await expect(secondResult).resolves.toEqual({ revision: 6 });
  });

  it('continues after a failed save without inventing a revision', async () => {
    const queue = new RevisionSaveQueue(7);
    const failure = new Error('network unavailable');
    const save = vi
      .fn<(revision: number) => Promise<{ revision: number }>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ revision: 8 });

    await expect(queue.enqueue(save)).rejects.toBe(failure);
    await expect(queue.enqueue(save)).resolves.toEqual({ revision: 8 });
    expect(save).toHaveBeenNthCalledWith(1, 7);
    expect(save).toHaveBeenNthCalledWith(2, 7);
  });
});
