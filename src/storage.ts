import {ResponseCollection, StorageRequest, StorageSource} from "@cycle/storage";
import Stream from "xstream";
import dropRepeats from "xstream/extra/dropRepeats";

export const loadNumber = (
    storage: StorageSource,
    key: string,
    accept: (value: string) => boolean = (value) => value !== "" && !isNaN(+value),
): Stream<number> =>
    ((storage as any as ResponseCollection).local.getItem(key) as Stream<string | null>)
        .filter((value) => value !== null && accept(value))
        .map((value) => +(value as string))
        .take(1);

export const saveValue = <S>(state$: Stream<S>, key: string, select: (state: S) => number): Stream<StorageRequest> =>
    state$
        .filter((state) => !!state)
        .map(select)
        .compose(dropRepeats())
        .drop(1)
        .map((value) => ({ key, value: value.toString() }) as StorageRequest);
