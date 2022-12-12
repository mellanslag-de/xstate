import {
  AssignAction,
  Assigner,
  Behavior,
  Condition,
  ConditionPredicate,
  Event,
  EventData,
  EventObject,
  EventType,
  Guard,
  GuardMeta,
  HistoryValue,
  InvokeSourceDefinition,
  Mapper,
  NullEvent,
  Observer,
  PropertyAssigner,
  PropertyMapper,
  SCXML,
  SingleOrArray,
  StateLike,
  StateValue,
  Subscribable,
  TransitionConfig,
  TransitionConfigTarget
} from './types';
import {
  DEFAULT_GUARD_TYPE,
  STATE_DELIMITER,
  TARGETLESS_KEY
} from './constants';
import { IS_PRODUCTION } from './environment';
import { StateNode } from './StateNode';
import { State } from './State';
import { Actor } from './Actor';
import { AnyStateMachine } from '.';

export function keys<T extends object>(value: T): Array<keyof T & string> {
  return Object.keys(value) as Array<keyof T & string>;
}

export function matchesState(
  parentStateId: StateValue,
  childStateId: StateValue,
  delimiter: string = STATE_DELIMITER
): boolean {
  const parentStateValue = toStateValue(parentStateId, delimiter);
  const childStateValue = toStateValue(childStateId, delimiter);

  if (isString(childStateValue)) {
    if (isString(parentStateValue)) {
      return childStateValue === parentStateValue;
    }

    // Parent more specific than child
    return false;
  }

  if (isString(parentStateValue)) {
    return parentStateValue in childStateValue;
  }

  return Object.keys(parentStateValue).every((key) => {
    if (!(key in childStateValue)) {
      return false;
    }

    return matchesState(parentStateValue[key], childStateValue[key]);
  });
}

export function getEventType<TEvent extends EventObject = EventObject>(
  event: Event<TEvent>
): TEvent['type'] {
  try {
    return isString(event) ? `${event}` : (event as TEvent).type;
  } catch (e) {
    throw new Error(
      'Events must be strings or objects with a string event.type property.'
    );
  }
}

export function toStatePath(
  stateId: string | string[],
  delimiter: string
): string[] {
  try {
    if (isArray(stateId)) {
      return stateId;
    }

    return stateId.toString().split(delimiter);
  } catch (e) {
    throw new Error(`'${stateId}' is not a valid state path.`);
  }
}

export function isStateLike(state: any): state is StateLike<any> {
  return (
    typeof state === 'object' &&
    'value' in state &&
    'context' in state &&
    'event' in state &&
    '_event' in state
  );
}

export function toStateValue(
  stateValue: StateLike<any> | StateValue | string[],
  delimiter: string
): StateValue {
  if (isStateLike(stateValue)) {
    return stateValue.value;
  }

  if (isArray(stateValue)) {
    return pathToStateValue(stateValue);
  }

  if (typeof stateValue !== 'string') {
    return stateValue as StateValue;
  }

  const statePath = toStatePath(stateValue as string, delimiter);

  return pathToStateValue(statePath);
}

export function pathToStateValue(statePath: string[]): StateValue {
  if (statePath.length === 1) {
    return statePath[0];
  }

  const value = {};
  let marker = value;

  for (let i = 0; i < statePath.length - 1; i++) {
    if (i === statePath.length - 2) {
      marker[statePath[i]] = statePath[i + 1];
    } else {
      marker[statePath[i]] = {};
      marker = marker[statePath[i]];
    }
  }

  return value;
}

export function mapValues<P, O extends Record<string, unknown>>(
  collection: O,
  iteratee: (item: O[keyof O], key: keyof O, collection: O, i: number) => P
): { [key in keyof O]: P };
export function mapValues(
  collection: Record<string, unknown>,
  iteratee: (
    item: unknown,
    key: string,
    collection: Record<string, unknown>,
    i: number
  ) => unknown
) {
  const result: Record<string, unknown> = {};

  const collectionKeys = Object.keys(collection);
  for (let i = 0; i < collectionKeys.length; i++) {
    const key = collectionKeys[i];
    result[key] = iteratee(collection[key], key, collection, i);
  }

  return result;
}

export function mapFilterValues<T, P>(
  collection: { [key: string]: T },
  iteratee: (item: T, key: string, collection: { [key: string]: T }) => P,
  predicate: (item: T) => boolean
): { [key: string]: P } {
  const result: { [key: string]: P } = {};

  for (const key of Object.keys(collection)) {
    const item = collection[key];

    if (!predicate(item)) {
      continue;
    }

    result[key] = iteratee(item, key, collection);
  }

  return result;
}

/**
 * Retrieves a value at the given path.
 * @param props The deep path to the prop of the desired value
 */
export const path = <T extends Record<string, any>>(props: string[]): any => (
  object: T
): any => {
  let result: T = object;

  for (const prop of props) {
    result = result[prop as keyof typeof result];
  }

  return result;
};

/**
 * Retrieves a value at the given path via the nested accessor prop.
 * @param props The deep path to the prop of the desired value
 * @param accessorProp
 */
export function nestedPath<T extends Record<string, any>>(
  props: string[],
  accessorProp: keyof T
): (object: T) => T {
  return (object) => {
    let result: T = object;

    for (const prop of props) {
      result = result[accessorProp][prop];
    }

    return result;
  };
}

export function toStatePaths(stateValue: StateValue | undefined): string[][] {
  if (!stateValue) {
    return [[]];
  }

  if (isString(stateValue)) {
    return [[stateValue]];
  }

  return flatten(
    Object.keys(stateValue).map((key) => {
      const subStateValue = stateValue[key];

      if (
        typeof subStateValue !== 'string' &&
        (!subStateValue || !Object.keys(subStateValue).length)
      ) {
        return [[key]];
      }

      return toStatePaths(stateValue[key]).map((subPath) => {
        return [key].concat(subPath);
      });
    })
  );
}

export function pathsToStateValue(paths: string[][]): StateValue {
  const result: StateValue = {};

  if (paths && paths.length === 1 && paths[0].length === 1) {
    return paths[0][0];
  }

  for (const currentPath of paths) {
    let marker = result;
    // tslint:disable-next-line:prefer-for-of
    for (let i = 0; i < currentPath.length; i++) {
      const subPath = currentPath[i];

      if (i === currentPath.length - 2) {
        marker[subPath] = currentPath[i + 1];
        break;
      }
      marker[subPath] = marker[subPath] || {};
      marker = marker[subPath] as {};
    }
  }

  return result;
}

export function flatten<T>(array: Array<T | T[]>): T[] {
  return ([] as T[]).concat(...array);
}

export function toArrayStrict<T>(value: T[] | T): T[] {
  if (isArray(value)) {
    return value;
  }
  return [value];
}

export function toArray<T>(value: T[] | T | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return toArrayStrict(value);
}

export function mapContext<TContext, TEvent extends EventObject>(
  mapper: Mapper<TContext, TEvent, any> | PropertyMapper<TContext, TEvent, any>,
  context: TContext,
  _event: SCXML.Event<TEvent>
): any {
  if (isFunction(mapper)) {
    return mapper(context, _event.data);
  }

  const result = {} as any;

  for (const key of Object.keys(mapper)) {
    const subMapper = mapper[key];

    if (isFunction(subMapper)) {
      result[key] = subMapper(context, _event.data);
    } else {
      result[key] = subMapper;
    }
  }

  return result;
}

export function isBuiltInEvent(eventType: EventType): boolean {
  return /^(done|error)\./.test(eventType);
}

export function isPromiseLike(value: any): value is PromiseLike<any> {
  if (value instanceof Promise) {
    return true;
  }
  // Check if shape matches the Promise/A+ specification for a "thenable".
  return (
    value !== null &&
    (isFunction(value) || typeof value === 'object') &&
    isFunction(value.then)
  );
}

export function isBehavior(value: any): value is Behavior<any, any> {
  return (
    value !== null &&
    typeof value === 'object' &&
    'transition' in value &&
    typeof value.transition === 'function'
  );
}

export function partition<T, A extends T, B extends T>(
  items: T[],
  predicate: (item: T) => item is A
): [A[], B[]] {
  const [truthy, falsy] = [[], []] as [A[], B[]];

  for (const item of items) {
    if (predicate(item)) {
      truthy.push(item);
    } else {
      falsy.push(item as B);
    }
  }

  return [truthy, falsy];
}

export function updateHistoryStates(
  hist: HistoryValue,
  stateValue: StateValue
): Record<string, HistoryValue | undefined> {
  return mapValues(hist.states, (subHist, key) => {
    if (!subHist) {
      return undefined;
    }
    const subStateValue =
      (isString(stateValue) ? undefined : stateValue[key]) ||
      (subHist ? subHist.current : undefined);

    if (!subStateValue) {
      return undefined;
    }

    return {
      current: subStateValue,
      states: updateHistoryStates(subHist, subStateValue)
    };
  });
}

export function updateHistoryValue(
  hist: HistoryValue,
  stateValue: StateValue
): HistoryValue {
  return {
    current: stateValue,
    states: updateHistoryStates(hist, stateValue)
  };
}

export function updateContext<TContext, TEvent extends EventObject>(
  context: TContext,
  _event: SCXML.Event<TEvent>,
  assignActions: Array<AssignAction<TContext, TEvent>>,
  state?: State<TContext, TEvent>
): TContext {
  if (!IS_PRODUCTION) {
    warn(!!context, 'Attempting to update undefined context');
  }

  function mergeAssignments(
    sourceContext: TContext,
    assignAction: AssignAction<TContext, TEvent>
  ): TContext {
    const meta = {
      state,
      action: assignAction,
      _event
    };

    let contextKeysToMerge: Partial<TContext> = {};

    const assignment:
      | Assigner<TContext, TEvent>
      | PropertyAssigner<TContext, TEvent> = assignAction.assignment;

    if (isFunction(assignment)) {
      contextKeysToMerge = assignment(sourceContext, _event.data, meta);
    } else {
      for (const contextKey of Object.keys(assignment)) {
        const contextKeyAssignment = assignment[contextKey];

        contextKeysToMerge[contextKey] = isFunction(contextKeyAssignment)
          ? contextKeyAssignment(sourceContext, _event.data, meta)
          : contextKeyAssignment;
      }
    }

    return Object.assign({}, sourceContext, contextKeysToMerge);
  }

  return context ? assignActions.reduce(mergeAssignments, context) : context;
}

// tslint:disable-next-line:no-empty
let warn: (condition: boolean | Error, message: string) => void = () => {};

if (!IS_PRODUCTION) {
  warn = (condition: boolean | Error, message: string) => {
    const error = condition instanceof Error ? condition : undefined;
    if (!error && condition) {
      return;
    }

    if (console !== undefined) {
      const args: [string, ...any[]] = [`Warning: ${message}`];
      if (error) {
        args.push(error);
      }
      // tslint:disable-next-line:no-console
      console.warn.apply(console, args);
    }
  };
}

export { warn };

export function isArray(value: any): value is any[] {
  return Array.isArray(value);
}

// tslint:disable-next-line:ban-types
export function isFunction(value: any): value is Function {
  return typeof value === 'function';
}

export function isString(value: any): value is string {
  return typeof value === 'string';
}

export function toGuard<TContext, TEvent extends EventObject>(
  condition?: Condition<TContext, TEvent>,
  guardMap?: Record<string, ConditionPredicate<TContext, TEvent>>
): Guard<TContext, TEvent> | undefined {
  if (!condition) {
    return undefined;
  }

  if (isString(condition)) {
    return {
      type: DEFAULT_GUARD_TYPE,
      name: condition,
      predicate: guardMap ? guardMap[condition] : undefined
    };
  }

  if (isFunction(condition)) {
    return {
      type: DEFAULT_GUARD_TYPE,
      name: condition.name,
      predicate: condition
    };
  }

  return condition;
}

export function isObservable<T>(value: any): value is Subscribable<T> {
  try {
    return 'subscribe' in value && isFunction(value.subscribe);
  } catch (e) {
    return false;
  }
}

export const symbolObservable: typeof Symbol.observable = (() =>
  (typeof Symbol === 'function' && Symbol.observable) ||
  '@@observable')() as any;

// TODO: to be removed in v5, left it out just to minimize the scope of the change and maintain compatibility with older
// versions of integration packages
export const interopSymbols = {
  [symbolObservable]() {
    return this;
  },
  [Symbol.observable]() {
    return this;
  }
};

export function isMachine(value: any): value is AnyStateMachine {
  return !!value && '__xstatenode' in value;
}

export function isActor(value: any): value is Actor {
  return !!value && typeof value.send === 'function';
}

export const uniqueId = (() => {
  let currentId = 0;

  return () => {
    currentId++;
    return currentId.toString(16);
  };
})();

export function toEventObject<TEvent extends EventObject>(
  event: Event<TEvent>,
  payload?: EventData
  // id?: TEvent['type']
): TEvent {
  if (isString(event)) {
    return { type: event, ...payload } as TEvent;
  }

  return event;
}

export function toSCXMLEvent<TEvent extends EventObject>(
  event: Event<TEvent> | SCXML.Event<TEvent>,
  scxmlEvent?: Partial<SCXML.Event<TEvent>>
): SCXML.Event<TEvent> {
  if (!isString(event) && '$$type' in event && event.$$type === 'scxml') {
    return event as SCXML.Event<TEvent>;
  }

  const eventObject = toEventObject(event as Event<TEvent>);

  return {
    name: eventObject.type,
    data: eventObject,
    $$type: 'scxml',
    type: 'external',
    ...scxmlEvent
  };
}

export function toTransitionConfigArray<TContext, TEvent extends EventObject>(
  event: TEvent['type'] | NullEvent['type'] | '*',
  configLike: SingleOrArray<
    | TransitionConfig<TContext, TEvent>
    | TransitionConfigTarget<TContext, TEvent>
  >
): Array<
  TransitionConfig<TContext, TEvent> & {
    event: TEvent['type'] | NullEvent['type'] | '*';
  }
> {
  return toArrayStrict(configLike).map((transitionLike) => {
    if (
      typeof transitionLike === 'undefined' ||
      typeof transitionLike === 'string' ||
      isMachine(transitionLike)
    ) {
      return { target: transitionLike, event };
    }

    return { ...transitionLike, event };
  }) as Array<
    TransitionConfig<TContext, TEvent> & {
      event: TEvent['type'] | NullEvent['type'] | '*';
    } // TODO: fix 'as' (remove)
  >;
}

export function normalizeTarget<TContext, TEvent extends EventObject>(
  target: SingleOrArray<string | StateNode<TContext, any, TEvent>> | undefined
): Array<string | StateNode<TContext, any, TEvent>> | undefined {
  if (target === undefined || target === TARGETLESS_KEY) {
    return undefined;
  }
  return toArray(target);
}

export function reportUnhandledExceptionOnInvocation(
  originalError: any,
  currentError: any,
  id: string
) {
  if (!IS_PRODUCTION) {
    const originalStackTrace = originalError.stack
      ? ` Stacktrace was '${originalError.stack}'`
      : '';
    if (originalError === currentError) {
      // tslint:disable-next-line:no-console
      console.error(
        `Missing onError handler for invocation '${id}', error was '${originalError}'.${originalStackTrace}`
      );
    } else {
      const stackTrace = currentError.stack
        ? ` Stacktrace was '${currentError.stack}'`
        : '';
      // tslint:disable-next-line:no-console
      console.error(
        `Missing onError handler and/or unhandled exception/promise rejection for invocation '${id}'. ` +
          `Original error: '${originalError}'. ${originalStackTrace} Current error is '${currentError}'.${stackTrace}`
      );
    }
  }
}

export function evaluateGuard<TContext, TEvent extends EventObject>(
  machine: StateNode<TContext, any, TEvent, any, any>,
  guard: Guard<TContext, TEvent>,
  context: TContext,
  _event: SCXML.Event<TEvent>,
  state: State<TContext, TEvent>
): boolean {
  const { guards } = machine.options;
  const guardMeta: GuardMeta<TContext, TEvent> = {
    state,
    cond: guard,
    _event
  };

  // TODO: do not hardcode!
  if (guard.type === DEFAULT_GUARD_TYPE) {
    return (guards?.[guard.name] || guard.predicate)(
      context,
      _event.data,
      guardMeta
    );
  }

  const condFn = guards?.[guard.type];

  if (!condFn) {
    throw new Error(
      `Guard '${guard.type}' is not implemented on machine '${machine.id}'.`
    );
  }

  return (condFn as any)(context, _event.data, guardMeta);
}

export function toInvokeSource(
  src: string | InvokeSourceDefinition
): InvokeSourceDefinition {
  if (typeof src === 'string') {
    return { type: src };
  }

  return src;
}

export function toObserver<T>(
  nextHandler?: Partial<Observer<T>> | ((value: T) => void),
  errorHandler?: (error: any) => void,
  completionHandler?: () => void
): Observer<T> {
  // tslint:disable-next-line:no-empty
  const noop = () => {};
  const isObserver = typeof nextHandler === 'object';
  const self = isObserver ? nextHandler : null;

  return {
    next: ((isObserver ? nextHandler.next : nextHandler) || noop).bind(self),
    error: ((isObserver ? nextHandler.error : errorHandler) || noop).bind(self),
    complete: (
      (isObserver ? nextHandler.complete : completionHandler) || noop
    ).bind(self)
  };
}

export function createInvokeId(stateNodeId: string, index: number): string {
  return `${stateNodeId}:invocation[${index}]`;
}
