import {RequestOptions} from "@cycle/http";
import {deepStrictEqual, strictEqual} from "node:assert/strict";
import {test} from "node:test";
import Stream from "xstream";
import {State as TradeState} from "../src/components/trade";
import {intent as tradeIntent} from "../src/components/trade/intent";
import {model as tradeModel} from "../src/components/trade/model";
import {State} from "../src/components/trade/order";
import {intent} from "../src/components/trade/order/intent";
import {model} from "../src/components/trade/order/model";
import {orderRequests} from "../src/components/trade/order/request";
import {flattenStopOrders, retainActive} from "../src/models/parentStopOrders";
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
    strictEqual(flattenStopOrders(state().parentStopOrders).length, 1);

    parentResponses.shamefullySendNext(Stream.of<unknown>({ request: requests[1] }));
    deepStrictEqual(flattenStopOrders(state().parentStopOrders), []);
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

    deepStrictEqual(flattenStopOrders(state().parentStopOrders).map(({price}) => price), [200]);
    deepStrictEqual(Object.keys(state().parentStopOrders), ["JCO-failure", "JCO-pending-detail"]);
    strictEqual(JSON.parse(requests[3].send).parent_order_id, "JCO-pending-detail");
});

test("A late parent detail response cannot restore a canceled stop", () => {
    const {sendParentDetail, parentResponses, requests, state} = clearOrders(["JCO-canceled"]);
    parentResponses.shamefullySendNext(Stream.of<unknown>({ request: requests[1] }));
    const canceledState = state();

    sendParentDetail("JCO-canceled", 100);

    strictEqual(state(), canceledState);
});

test("A late active list and its details cannot restore a canceled stop", () => {
    const {sendParentDetail, lists, parentResponses, requests, state} = clearOrders(["JCO-canceled", "JCO-active"]);
    const pendingList$ = Stream.create<unknown>();
    lists.shamefullySendNext(pendingList$);
    parentResponses.shamefullySendNext(Stream.of<unknown>({ request: requests[1] }));

    pendingList$.shamefullySendNext({ text: JSON.stringify([
        { parent_order_id: "JCO-canceled" },
        { parent_order_id: "JCO-active" },
        { parent_order_id: "JCO-new" },
    ]) });
    sendParentDetail("JCO-canceled", 100);
    sendParentDetail("JCO-new", 300);

    deepStrictEqual(Object.keys(state().parentStopOrders), ["JCO-active", "JCO-new"]);
    deepStrictEqual(flattenStopOrders(state().parentStopOrders).map(({price}) => price), [200, 300]);
});

function clearOrders(ids: string[], lastDetailPending = false) {
    const clicks$ = Stream.create();
    const childResponses = Stream.create<Stream<unknown>>();
    const parentResponses = Stream.create<Stream<unknown>>();
    const details = Stream.create<Stream<unknown>>();
    const lists = Stream.create<Stream<unknown>>();
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
                    "parent-order": details,
                    "parent-orders": lists,
                }[category] || Stream.never();
            },
        },
        socket: {
            childOrderEvent$: Stream.never(),
            execution$: Stream.never(),
            executionBatch$: Stream.never(),
            parentOrderEvent$: Stream.never(),
            reconnect$: Stream.never(),
        },
        storage: { local: { getItem: () => Stream.never() } },
    } as unknown as Parameters<typeof intent>[0];
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: { "api-key": "test-key", "api-secret": "test-secret" },
    });
    const state$ = Stream.createWithMemory<State>();
    const actions = intent(sources, state$);
    let currentState: State & TradeState;
    model(actions, Stream.of(false)).addListener({
        next: (reducer) => {
            currentState = reducer(currentState)! as State & TradeState;
            state$.shamefullySendNext(currentState);
        },
    });

    const tradeActions = tradeIntent(sources);
    tradeModel(tradeActions).addListener({
        next: (reducer) => {
            currentState = reducer(currentState)! as State & TradeState;
            state$.shamefullySendNext(currentState);
        },
    });

    const stopOrders = ids.slice(0, lastDetailPending ? -1 : ids.length)
        .map((_, index) => new StopOrder({ trigger_price: (index + 1) * 100 }));
    const loadedStops = Object.fromEntries(stopOrders.map((order, index) => [ids[index], [order]]));
    const parentStopOrders = retainActive(loadedStops, ids.map((id) => ({ parent_order_id: id })));
    currentState = { ...currentState!, parentStopOrders };
    state$.shamefullySendNext(currentState);

    const detailRequests = new Map<string, RequestOptions>();
    tradeActions.parentOrderRequests$.addListener({
        next: (request) => {
            const {parent_order_id} = request.query as { parent_order_id: string };
            detailRequests.set(parent_order_id, request);
        },
    });
    lists.shamefullySendNext(Stream.of({ text: JSON.stringify(ids.map((id) => ({ parent_order_id: id }))) }));

    const sendParentDetail = (id: string, price: number) => {
        const request = detailRequests.get(id);
        strictEqual(detailRequests.has(id), true);
        const response$ = Stream.of<unknown>({ text: JSON.stringify({
            parameters: [{ condition_type: "STOP", trigger_price: price }],
            parent_order_id: id,
        }) });
        details.shamefullySendNext(Object.assign(response$, { request }));
    };

    const requests: Array<{ url: string; method: string; send: string }> = [];
    orderRequests(actions, state$).addListener({ next: (batch) => requests.push(...batch.requests as typeof requests) });
    clicks$.shamefullySendNext(null);

    return { childResponses, sendParentDetail, lists, parentResponses, requests, state: () => currentState };
}
