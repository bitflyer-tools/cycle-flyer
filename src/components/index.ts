import {a, div, DOMSource, h1, header, VNode} from "@cycle/dom";
import {HTTPSource, RequestInput} from "@cycle/http";
import isolate from "@cycle/isolate";
import {Reducer, StateSource} from "@cycle/state";
import {StorageRequest, StorageSource} from "@cycle/storage";
import {RouterSource} from "cyclic-router";
import Stream from "xstream";
import {credentialsChanging$} from "../credentials";
import {SocketIOSource} from "../drivers/socketIODriver";
import {Sound} from "../drivers/soundDriver";
import {Setting} from "./setting";
import {State as TradeState, Trade} from "./trade";

interface RootState {
    trade?: TradeState;
}

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

export const Root = (sources: Sources): Sinks => {
    const routes$ = sources.router
        .define({
            "/": isolate(Trade, { "*": "trade" }),
            "/setting": isolate(Setting, { "*": "setting" }),
        })
        .map((route: any) => route.value({...sources, router: sources.router.path(route.path)}));

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
        HTTP: routes$.map((sinks: Sinks) => sinks.HTTP).flatten(),
        router: routes$.map((sinks: Sinks) => sinks.router).flatten(),
        sound: routes$.map((sinks: Sinks) => sinks.sound || Stream.never()).flatten(),
        state: Stream.merge(
            routes$.map((sinks: Sinks) => sinks.state).flatten(),
            credentialsChanging$.mapTo(resetTwap),
        ),
        storage: routes$.map((sinks: Sinks) => sinks.storage).flatten(),
    };
};

const resetTwap: Reducer<RootState> = (state) => {
    const trade = state?.trade;
    const order = trade?.orderComponentState;
    if (!trade || !order || !order.twap.remaining) { return state; }
    const orderComponentState = { ...order, twap: { ...order.twap, remaining: 0 } };
    return { ...state, trade: { ...trade, orderComponentState } };
};
