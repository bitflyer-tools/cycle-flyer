import {DOMSource, VNode, span} from "@cycle/dom";
import {HTTPSource, RequestInput} from "@cycle/http";
import {Reducer, StateSource} from "cycle-onionify";
import {HistoryAction, RouterSource} from 'cyclic-router';
import Stream from "xstream";
import {model} from "./model";

export interface Sources {
    DOM: DOMSource;
    HTTP: HTTPSource;
    onion: StateSource<object>;
    router: RouterSource;
}

export interface Sinks {
    DOM: Stream<VNode>;
    HTTP: Stream<RequestInput|null>;
    onion: Stream<Reducer<object>>;
    router: Stream<HistoryAction>;
}

export const Setting = (sources: Sources): Sinks => {
    const reducer$ = model();

    return {
        DOM: Stream.of(span("settings")),
        HTTP: Stream.empty(),
        onion: reducer$,
        router: Stream.empty()
    }
};