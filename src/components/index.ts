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
import {Trade, type State as TradeState} from "./trade";
import {createOrderSubmissionState} from "./trade/orderSubmissionState";

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

// Trade's own state/sound/HTTP sinks only flow while "/" is the active route (routes$ switches
// away from them while on Settings), but order submissions must keep being tracked regardless of
// the current route. So the persistent order-submission orchestration (kept in trade/, see
// orderSubmissionState.ts) is merged in here unconditionally rather than through routes$.
const isolateTradeReducer = (reducer: Reducer<TradeState>): Reducer<any> => (outer: any) => {
    const prevInner = outer === undefined ? undefined : outer[tradeScope];
    const nextInner = reducer(prevInner);
    if (prevInner === nextInner) { return outer; }
    return outer === undefined ? { [tradeScope]: nextInner } : { ...outer, [tradeScope]: nextInner };
};

export const Root = (sources: Sources): Sinks => {
    const leaveTrade$ = Stream.create<void>();
    const trade = isolate(Trade, { "*": tradeScope });
    const orderSubmission = createOrderSubmissionState(sources.HTTP);
    const routes$: Stream<Sinks> = sources.router
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
                orderSubmission,
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
            orderSubmission.orderRequests$,
        ),
        router: routes$.map((sinks: Sinks) => sinks.router).flatten(),
        sound: Stream.merge(
            routes$.map((sinks: Sinks) => sinks.sound || Stream.never()).flatten(),
            orderSubmission.sound$,
        ),
        state: Stream.merge(
            routes$.map((sinks: Sinks) => sinks.state).flatten(),
            orderSubmission.reducer$.map(isolateTradeReducer),
        ),
        storage: routes$.map((sinks: Sinks) => sinks.storage).flatten(),
    };
};
