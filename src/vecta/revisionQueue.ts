export type RevisionedSaveResult = { revision: number };

export class RevisionSaveQueue {
  private revision: number;
  private tail: Promise<void> = Promise.resolve();

  constructor(initialRevision: number) {
    this.revision = initialRevision;
  }

  enqueue<Result extends RevisionedSaveResult>(save: (revision: number) => Promise<Result>): Promise<Result> {
    const operation = this.tail.then(() => save(this.revision));
    this.tail = operation.then(
      (result) => {
        this.revision = result.revision;
      },
      () => undefined,
    );
    return operation;
  }
}
