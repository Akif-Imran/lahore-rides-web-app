import type { PoolClient } from 'pg';
import { TransactionManager } from './transaction-manager.js';

function fakeClient(failOn?: string) {
  const statements: string[] = [];
  const release = vi.fn();
  const client = {
    statements,
    release,
    query: vi.fn(async (text: string) => {
      statements.push(text);
      if (text === failOn) throw new Error(`${text} failed`);
      return { rows: [], rowCount: 0 };
    }),
  };
  const pool = { connect: vi.fn(async () => client as unknown as PoolClient) };
  return { client, pool, manager: new TransactionManager(pool) };
}

describe('TransactionManager.run', () => {
  it('wraps the work in BEGIN/COMMIT, returns its result and releases the client', async () => {
    const { client, manager } = fakeClient();

    const result = await manager.run(async (tx) => {
      await tx.query('SELECT 1');
      return 42;
    });

    expect(result).toBe(42);
    expect(client.statements).toEqual(['BEGIN', 'SELECT 1', 'COMMIT']);
    expect(client.release).toHaveBeenCalledExactlyOnceWith();
  });

  it('rolls back, releases and rethrows the original error when the work fails', async () => {
    const { client, manager } = fakeClient();
    const failure = new Error('boom');

    await expect(
      manager.run(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(client.statements).toEqual(['BEGIN', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledExactlyOnceWith();
  });

  it('rolls back when COMMIT itself fails', async () => {
    const { client, manager } = fakeClient('COMMIT');

    await expect(manager.run(async () => 'ok')).rejects.toThrow('COMMIT failed');

    expect(client.statements).toEqual(['BEGIN', 'COMMIT', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledExactlyOnceWith();
  });

  it('destroys the connection if ROLLBACK fails, still surfacing the original error', async () => {
    const { client, manager } = fakeClient('ROLLBACK');
    const failure = new Error('work failed');

    await expect(
      manager.run(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(client.release).toHaveBeenCalledOnce();
    expect(client.release.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });
});
