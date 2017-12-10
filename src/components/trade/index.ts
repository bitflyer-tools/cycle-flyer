import {DOMSource, VNode} from "@cycle/dom";
import {HTTPSource, RequestInput} from "@cycle/http";
import {Reducer, StateSource} from "cycle-onionify";
import Stream from "xstream";
import {model} from "./model";
import {HistoryAction, RouterSource} from 'cyclic-router';
import {StorageRequest, StorageSource} from "@cycle/storage";
import {PubnubSource} from "../../drivers/pubnubDriver";
import {intent} from "./intent";
import {request} from "./request";
import {view} from "./view";

export interface Sources {
    DOM: DOMSource;
    HTTP: HTTPSource;
    onion: StateSource<object>;
    pubnub: PubnubSource;
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
    const actions = intent(sources);
    const reducer$ = model(actions);
    const view$ = view(sources.onion.state$);
    const request$ = request(actions, sources.onion.state$);

    return {
        DOM: view$,
        HTTP: request$,
        onion: reducer$,
        router: Stream.empty(),
        storage: Stream.empty()
    }
};
