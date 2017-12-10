import {a, div, DOMSource, h1, header, VNode} from "@cycle/dom";
import {HTTPSource, RequestInput} from "@cycle/http";
import isolate from "@cycle/isolate";
import {Reducer, StateSource} from "cycle-onionify";
import {HistoryAction, RouterSource} from "cyclic-router";
import Stream from "xstream";
import {Trade} from "./trade/index";
import {Setting} from "./setting/index";
import {StorageRequest, StorageSource} from "@cycle/storage";
import {PubnubSource} from "../drivers/pubnubDriver";

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

export const Root = (sources: Sources): Sinks => {
    const routes$ = sources.router
        .define({
            "/": isolate(Trade, { "*": "trade" }),
            "/setting": isolate(Setting, { "*": "setting" })
        })
        .map(route => route.value({...sources, router: sources.router.path(route.path)}));

    const view$ = routes$.map((sinks: Sinks) => sinks.DOM).flatten()
        .map(contentDOM =>
                div("#wrapper", [
                    header(".header", [
                        div(".header-wrapper", [
                            h1(".header-title", "cycle-flyer"),
                            a(".menu-trade", { props: { href: "/" } }, "Trade"),
                            a(".menu-setting", { props: { href: "/setting" } }, "Setting")
                        ])
                    ]),
                    div(".content", [contentDOM])
                ])
            );

    return {
        DOM: view$,
        HTTP: routes$.map((sinks: Sinks) => sinks.HTTP).flatten(),
        onion: routes$.map((sinks: Sinks) => sinks.onion).flatten(),
        router: routes$.map((sinks: Sinks) => sinks.router).flatten(),
        storage: routes$.map((sinks: Sinks) => sinks.storage).flatten()
    };
};
