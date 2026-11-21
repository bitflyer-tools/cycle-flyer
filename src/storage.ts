import storageDriver, {ResponseCollection, StorageRequest, StorageSource} from "@cycle/storage";
import Stream from "xstream";
import dropRepeats from "xstream/extra/dropRepeats";
import {apiCredentials} from "./credentials";

export const credentialAwareStorageDriver: typeof storageDriver = (requests$) => {
    const source = storageDriver(requests$);
    // The storage driver subscribes first and applies each write synchronously.
    requests$.addListener({ next: () => { apiCredentials(); } });
    return source;
};

export const loadNumber = (
    storage: StorageSource,
    key: string,
    accept: (value: string) => boolean = (value) => value !== "" && !isNaN(+value),
): Stream<number> =>
    loadStoredValue(storage, key)
        .filter(accept)
        .map((value) => +value)
        .take(1);

export const loadStoredValue = (storage: StorageSource, key: string): Stream<string> =>
    ((storage as any as ResponseCollection).local.getItem(key) as Stream<string | null>)
        .filter((value): value is string => value !== null);

export const saveValue = <S>(state$: Stream<S>, key: string, select: (state: S) => number): Stream<StorageRequest> =>
    state$
        .filter((state) => !!state)
        .map(select)
        .compose(dropRepeats())
        .drop(1)
        .map((value) => ({ key, value: value.toString() }) as StorageRequest);
