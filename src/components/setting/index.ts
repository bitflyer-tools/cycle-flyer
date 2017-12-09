import {DOMSource, VNode} from "@cycle/dom";
import {HTTPSource, RequestInput} from "@cycle/http";
import {Reducer, StateSource} from "cycle-onionify";
import {HistoryAction, RouterSource} from 'cyclic-router';
import Stream from "xstream";
import {model} from "./model";
import {StorageRequest, StorageSource} from '@cycle/storage';
import {view} from './view';
import {intent} from './intent';

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

export const Setting = (sources: Sources): Sinks => {
    const actions = intent(sources);
    const reducer$ = model(actions);
    const view$ = view(sources.onion.state$);
    const storage$ = Stream.merge(
        sources.onion.state$.map(state => ({ key: "api-key", value: state.apiKey})),
        sources.onion.state$.map(state => ({ key: "api-secret", value: state.apiSecret})),
    );

    return {
        DOM: view$,
        HTTP: Stream.empty(),
        onion: reducer$,
        router: Stream.empty(),
        storage: storage$
    }
};
