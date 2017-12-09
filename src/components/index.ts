import {DOMSource, VNode} from "@cycle/dom";
import {HTTPSource, RequestInput} from "@cycle/http";
import isolate from "@cycle/isolate";
import {Reducer, StateSource} from "cycle-onionify";
import {HistoryAction, RouterSource} from "cyclic-router";
import Stream from "xstream";
import {Trade} from "./trade/index";
import {Setting} from "./setting/index";

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

export const Root = (sources: Sources): Sinks => {
    const routes$ = sources.router
        .define({
            "/": isolate(Trade, { "*": "trade" }),
            "/setting": isolate(Setting, { "*": "setting" })
        })
        .map(route => route.value({...sources, router: sources.router.path(route.path)}));

    return {
        DOM: routes$.map((sinks: Sinks) => sinks.DOM).flatten(),
        HTTP: routes$.map((sinks: Sinks) => sinks.HTTP).flatten(),
        onion: routes$.map((sinks: Sinks) => sinks.onion).flatten(),
        router: routes$.map((sinks: Sinks) => sinks.router).flatten()
    };
};
