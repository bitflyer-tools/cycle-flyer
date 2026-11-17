import {Reducer} from "@cycle/state";
import {deepStrictEqual, strictEqual} from "node:assert/strict";
import {test} from "node:test";
import Stream from "xstream";
import {State as TradeState} from "../src/components/trade";
import {model as tradeModel} from "../src/components/trade/model";
import {State} from "../src/components/trade/order";
import {intent} from "../src/components/trade/order/intent";
import {model} from "../src/components/trade/order/model";
import {request} from "../src/components/trade/order/request";
import {retainActive} from "../src/models/parentStopOrders";
import {StopOrder} from "../src/models/stopOrder";

test("Clear Orders cancels a standalone stop by parent order ID", () => {
    const {requests} = clearOrders(["JCO-stop"]);

    deepStrictEqual(requests.map(({url}) => new URL(url).pathname), [
        "/v1/me/cancelallchildorders",
        "/v1/me/cancelparentorder",
    ]);
    strictEqual(requests[1].method, "POST");
    deepStrictEqual(JSON.parse(requests[1].send), {
        parent_order_id: "JCO-stop",
        product_code: "FX_BTC_JPY",
    });
});

test("A standalone stop stays visible until its parent cancellation succeeds", () => {
    const {childResponses, parentResponses, requests, state} = clearOrders(["JCO-stop"]);

    childResponses.shamefullySendNext(Stream.of<unknown>({}));
    strictEqual(state().stopOrders.length, 1);

    parentResponses.shamefullySendNext(Stream.of<unknown>({ request: requests[1] }));
    deepStrictEqual(state().stopOrders, []);
    deepStrictEqual(Object.keys(state().parentStopOrders), []);
});

test("Concurrent parent cancellations leave failed orders visible", () => {
    const {parentResponses, requests, state} = clearOrders(["JCO-success", "JCO-failure", "JCO-pending-detail"], true);
    const success$ = Stream.create();
    const failure$ = Stream.create();

    parentResponses.shamefullySendNext(success$);
    parentResponses.shamefullySendNext(failure$);
    failure$.shamefullySendError(new Error("Cancellation failed"));
    success$.shamefullySendNext({ request: requests[1] });

    deepStrictEqual(state().stopOrders.map(({price}) => price), [200]);
    deepStrictEqual(Object.keys(state().parentStopOrders), ["JCO-failure", "JCO-pending-detail"]);
    strictEqual(JSON.parse(requests[3].send).parent_order_id, "JCO-pending-detail");
});

test("A late parent detail response cannot restore a canceled stop", () => {
    const details$ = Stream.create<{ parent_order_id: string; parameters: object[] }>();
    const inactive$ = Stream.never();
    const actions = {
        onExecutionCreated$: inactive$,
        onMyExecutionCreated$: inactive$,
        onOrdersLoaded$: inactive$,
        onParentOrderLoaded$: details$,
        onParentOrdersLoaded$: inactive$,
        onPositionsLoaded$: inactive$,
    } as unknown as Parameters<typeof tradeModel>[0];
    const reducers: Array<Reducer<TradeState>> = [];
    tradeModel(actions).addListener({ next: (reducer) => reducers.push(reducer) });
    const cancellation = clearOrders(["JCO-canceled"]);
    cancellation.parentResponses.shamefullySendNext(Stream.of<unknown>({ request: cancellation.requests[1] }));
    const { parentStopOrders, stopOrders } = cancellation.state();
    const state = { ...reducers[0](undefined)!, parentStopOrders, stopOrders };

    details$.shamefullySendNext({
        parameters: [{ condition_type: "STOP", trigger_price: 100 }],
        parent_order_id: "JCO-canceled",
    });

    strictEqual(reducers[1](state), state);
});

function clearOrders(ids: string[], lastDetailPending = false) {
    const clicks$ = Stream.create();
    const childResponses = Stream.create<Stream<unknown>>();
    const parentResponses = Stream.create<Stream<unknown>>();
    const sources = {
        DOM: {
            select(selector: string) {
                return selector === ".clear-order-button" ? { events: () => clicks$ } : this;
            },
            events: () => Stream.never(),
        },
        HTTP: {
            select(category: string) {
                return {
                    "cancel-orders": childResponses,
                    "cancel-parent-order": parentResponses,
                }[category] || Stream.never();
            },
        },
        storage: { local: { getItem: () => Stream.never() } },
    } as unknown as Parameters<typeof intent>[0];
    const actions = intent(sources);
    const state$ = Stream.createWithMemory<State>();
    let currentState: State;
    model(actions).addListener({
        next: (reducer) => {
            currentState = reducer(currentState)!;
            state$.shamefullySendNext(currentState);
        },
    });

    const stopOrders = ids.slice(0, lastDetailPending ? -1 : ids.length)
        .map((_, index) => new StopOrder({ trigger_price: (index + 1) * 100 }));
    const loadedStops = Object.fromEntries(stopOrders.map((order, index) => [ids[index], [order]]));
    const parentStopOrders = retainActive(loadedStops, ids.map((id) => ({ parent_order_id: id })));
    currentState = { ...currentState!, parentStopOrders, stopOrders };
    state$.shamefullySendNext(currentState);

    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: { "api-key": "test-key", "api-secret": "test-secret" },
    });
    const requests: Array<{ url: string; method: string; send: string }> = [];
    request(actions, state$).addListener({ next: (input) => requests.push(input as typeof requests[number]) });
    clicks$.shamefullySendNext(null);

    return { childResponses, parentResponses, requests, state: () => currentState };
}
