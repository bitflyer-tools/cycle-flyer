import {a, div, DOMSource, h1, header, VNode} from "@cycle/dom";
import {HTTPSource, RequestInput} from "@cycle/http";
import isolate from "@cycle/isolate";
import {Reducer, StateSource} from "@cycle/state";
import {StorageRequest, StorageSource} from "@cycle/storage";
import {RouterSource} from "cyclic-router";
import Stream from "xstream";
import {SocketIOSource} from "../drivers/socketIODriver";
import {Sound} from "../drivers/soundDriver";
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
    sound?: Stream<Sound>;
}

const tradeScope = "trade";

export const Root = (sources: Sources): Sinks => {
    const leaveTrade$ = Stream.create<void>();
    const trade = isolate(Trade, { "*": tradeScope });
    const routes$: Stream<Sinks & { orderRequests?: Stream<RequestInput | null> }> = sources.router
        .define({
            "/": trade,
            "/setting": isolate(Setting, { "*": "setting" }),
        })
        .map((route: any) => {
            // Cancel while the outgoing Trade reducer is still subscribed.
            if (route.value !== trade) { leaveTrade$.shamefullySendNext(undefined); }
            return route.value({
                ...sources,
                // Tag order submissions with the same HTTP scope as the other requests.
                orderRequests: sources.HTTP,
                router: sources.router.path(route.path),
            }, leaveTrade$);
        })
        .remember();

    const view$ = routes$.map((sinks: Sinks) => sinks.DOM).flatten()
        .map((contentDOM: any) =>
                div("#wrapper", [
                    header(".header", [
                        div(".header-wrapper", [
                            h1(".header-title", "cycle-flyer"),
                            a(".menu-trade", { props: { href: "/" } }, "Trade"),
                            a(".menu-setting", { props: { href: "/setting" } }, "Setting"),
                        ]),
                    ]),
                    div(".content", [contentDOM]),
                ]),
            );

    return {
        DOM: view$,
        HTTP: Stream.merge(
            routes$.map((sinks) => sinks.HTTP).flatten(),
            routes$.map((sinks) => sinks.orderRequests || Stream.never<RequestInput | null>()).flatten(),
        ),
        router: routes$.map((sinks: Sinks) => sinks.router).flatten(),
        sound: routes$.map((sinks: Sinks) => sinks.sound || Stream.never()).flatten(),
        state: routes$.map((sinks: Sinks) => sinks.state).flatten(),
        storage: routes$.map((sinks: Sinks) => sinks.storage).flatten(),
    };
};
