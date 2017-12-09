import {DOMSource, span, VNode} from "@cycle/dom";
import {HTTPSource, RequestInput} from "@cycle/http";
import {Reducer, StateSource} from "cycle-onionify";
import Stream from "xstream";
import {model} from "./model";
import {RouterSource, HistoryAction} from 'cyclic-router';
import {StorageSource, StorageRequest} from "@cycle/storage";

export interface Sources {
    DOM: DOMSource;
    HTTP: HTTPSource;
    onion: StateSource<object>;
    router: RouterSource;
    storage: StorageSource;
}

export interface Sinks {
    DOM: Stream<VNode>;
    HTTP: Stream<RequestInput|null>;
    onion: Stream<Reducer<object>>;
    router: Stream<HistoryAction>;
    storage: Stream<StorageRequest>;
}

export const Trade = (sources: Sources): Sinks => {
    const reducer$ = model();

    return {
        DOM: Stream.of(span("Trade")),
        HTTP: Stream.empty(),
        onion: reducer$,
        router: Stream.empty(),
        storage: Stream.empty()
    }
};
