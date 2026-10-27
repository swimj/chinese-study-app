import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { timeSqliteCall } from '../request-timing.ts';

const instrumented = new WeakSet<object>();
const timedStatementMethods = new Set<PropertyKey>(['run', 'get', 'all']);

/**
 * Wraps the live connection so every synchronous SQLite call is attributed to
 * the current request (or to background work). The proxy keeps the native
 * object as `this` because node:sqlite methods reject foreign receivers.
 */
export function instrumentDatabase(database: DatabaseSync): DatabaseSync {
  if (instrumented.has(database)) return database;
  if (typeof database.isTransaction !== 'boolean') {
    throw new Error('Statement timing requires node:sqlite DatabaseSync.isTransaction (Node 22.16 or later).');
  }
  const isTransaction = () => database.isTransaction;
  const nativePrepare = database.prepare as (this: DatabaseSync, ...args: unknown[]) => StatementSync;
  const nativeExec = database.exec as (this: DatabaseSync, sql: string) => void;
  const prepare = (sql: string, ...rest: unknown[]) => instrumentStatement(
    timeSqliteCall(sql, () => nativePrepare.call(database, sql, ...rest), isTransaction),
    sql,
    isTransaction,
  );
  const exec = (sql: string) => timeSqliteCall(sql, () => nativeExec.call(database, sql), isTransaction);
  const proxy = new Proxy(database, {
    get(target, property) {
      // Own properties are test or caller overrides assigned through the proxy.
      if (Object.hasOwn(target, property)) return Reflect.get(target, property, target);
      if (property === 'prepare') return prepare;
      if (property === 'exec') return exec;
      return bindToTarget(target, Reflect.get(target, property, target));
    },
  });
  instrumented.add(proxy);
  return proxy;
}

function instrumentStatement(statement: StatementSync, sql: string, isTransaction: () => boolean): StatementSync {
  return new Proxy(statement, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      if (timedStatementMethods.has(property)) {
        return (...args: unknown[]) => timeSqliteCall(
          sql,
          () => (value as (...methodArgs: unknown[]) => unknown).apply(target, args),
          isTransaction,
        );
      }
      if (property === 'iterate') {
        return (...args: unknown[]) => timeIterator(
          timeSqliteCall(sql, () => (value as (...methodArgs: unknown[]) => Iterator<unknown>).apply(target, args), isTransaction),
          sql,
          isTransaction,
        );
      }
      return value.bind(target);
    },
  });
}

function timeIterator(iterator: Iterator<unknown>, sql: string, isTransaction: () => boolean): IterableIterator<unknown> {
  const timed: IterableIterator<unknown> = {
    next: (...args: [] | [unknown]) => timeSqliteCall(sql, () => iterator.next(...args), isTransaction),
    return: (value?: unknown) => iterator.return?.(value) ?? { done: true, value },
    [Symbol.iterator]: () => timed,
  };
  return timed;
}

function bindToTarget(target: object, value: unknown): unknown {
  return typeof value === 'function' ? value.bind(target) : value;
}
