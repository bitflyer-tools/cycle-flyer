import {a, div, DOMSource, h1, header, VNode} from "@cycle/dom";
import {HTTPSource, RequestInput} from "@cycle/http";
import isolate from "@cycle/isolate";
import {Reducer, StateSource} from "@cycle/state";
import {StorageRequest, StorageSource} from "@cycle/storage";
import {RouterSource} from "cyclic-router";
import Stream from "xstream";
import {SocketIOSource} from "../drivers/socketIODriver";
import {Setting} from "./setting";
import {Trade} from "./trade";

export interface Sources {
    DOM: DOMSource;
    HTTP: HTTPSource;
    state: StateSource<object>;
    router: RouterSource;
    socket: SocketIOSource;
    storage: StorageSource;
}

export interface Sinks {
    DOM: Stream<VNode>;
    HTTP: Stream<RequestInput|null>;
    state: Stream<Reducer<any>>;
    router: Stream<any>;
    storage: Stream<StorageRequest>;
}

export const Root = (sources: Sources): Sinks => {
    const routes$ = sources.router
        .define({
            "/": isolate(Trade, { "*": "trade" }),
            "/setting": isolate(Setting, { "*": "setting" }),
        })
        .map((route: any) => route.value({...sources, router: sources.router.path(route.path)}));

    const tradeClick$ = sources.DOM.select(".menu-trade").events("click")
        .map((e: Event) => { e.preventDefault(); return "/"; });
    const settingClick$ = sources.DOM.select(".menu-setting").events("click")
        .map((e: Event) => { e.preventDefault(); return "/setting"; });
    const menuNav$ = Stream.merge(tradeClick$, settingClick$);

    const view$ = routes$.map((sinks: Sinks) => sinks.DOM).flatten()
        .map((contentDOM: any) =>
                div("#wrapper", [
                    header(".header", [
                        div(".header-wrapper", [
                            h1(".header-title", "cycle-flyer"),
                            a(".menu-trade", { attrs: { href: "#" } }, "Trade"),
                            a(".menu-setting", { attrs: { href: "#" } }, "Setting"),
                        ]),
                    ]),
                    div(".content", [contentDOM]),
                ]),
            );

    const childRouter$ = routes$.map((sinks: Sinks) => sinks.router).flatten();

    return {
        DOM: view$,
        HTTP: routes$.map((sinks: Sinks) => sinks.HTTP).flatten(),
        router: Stream.merge(menuNav$, childRouter$),
        state: routes$.map((sinks: Sinks) => sinks.state).flatten(),
        storage: routes$.map((sinks: Sinks) => sinks.storage).flatten(),
    };
};
