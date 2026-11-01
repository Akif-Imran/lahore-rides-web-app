import type { QueryResult, QueryResultRow } from 'pg';

/**
 * Anything that can run a parameterised query: the pool (autocommit, for reads) or a
 * client checked out by TransactionManager (inside BEGIN/COMMIT). Repositories accept this
 * so the caller decides the transactional context explicitly.
 */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
}
