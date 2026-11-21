import assert from "node:assert/strict";
import {test} from "node:test";
import {VNode} from "@cycle/dom";
import {Reducer} from "@cycle/state";
import Stream from "xstream";
import {Actions as TradeActions} from "../src/components/trade/intent";
import {model as tradeModel} from "../src/components/trade/model";
import {TwapSliceOutcome} from "../src/components/trade/order/history";
import {Actions as OrderActions} from "../src/components/trade/order/intent";
import {model as orderModel} from "../src/components/trade/order/model";
import {State as SummaryState} from "../src/components/trade/summary";
import {view} from "../src/components/trade/summary/view";
import {Execution} from "../src/models/execution";
import {ChildOrderEvent} from "../src/models/orderEvent";
import {createOrderHistory, HISTORY_LIMIT} from "../src/models/orderHistory";

const withIdleActions = <Actions>(actions: Partial<Actions>): Actions =>
    new Proxy(actions, { get: (target, key) => Reflect.get(target, key) ?? Stream.never() }) as Actions;

const collectState = <State>(reducers$: Stream<Reducer<State>>) => {
    let state: State | undefined;
    reducers$.addListener({ next: (reducer) => { state = reducer(state); } });
    return () => state!;
};

const child = (node: VNode, selector: string): VNode => {
    const match = node.children?.find((entry) => typeof entry !== "string" && entry.sel === selector);
    assert.ok(match && typeof match !== "string");
    return match;
};

test("TWAP slice results retain only the newest history entries", () => {
    const slices$ = Stream.create<TwapSliceOutcome>();
    const state = collectState(orderModel(withIdleActions<OrderActions>({
        onTwapSliceOutcome$: slices$,
    }), Stream.of(false)));

    const entries = Array.from({ length: HISTORY_LIMIT * 2 + 2 }, (_, index) =>
        createOrderHistory("Order", "BUY", index, 0, "success"),
    );
    const scheduleId = Symbol();
    const sliceEntries = entries.slice(1, -1);
    slices$.shamefullySendNext({ status: "success", scheduleId, histories: entries.slice(0, 1) });
    slices$.shamefullySendNext({ status: "success", scheduleId, histories: sliceEntries });

    assert.deepEqual(state().histories, entries.slice(-HISTORY_LIMIT - 1, -1).reverse());
    assert.deepEqual(sliceEntries, entries.slice(1, -1));

    slices$.shamefullySendNext({ status: "success", scheduleId, histories: entries.slice(-1) });
    assert.deepEqual(state().histories, entries.slice(-HISTORY_LIMIT).reverse());
});

test("Private executions cap rendered rows and public executions reuse the history list", () => {
    const execution: ChildOrderEvent = {
        child_order_acceptance_id: "acceptance-id",
        child_order_id: "order-id",
        event_date: "2026-11-18T00:00:00Z",
        event_type: "EXECUTION",
        product_code: "FX_BTC_JPY",
    };
    const privateExecutions$ = Stream.create<ChildOrderEvent>();
    const publicExecutions$ = Stream.create<Execution[]>();
    const state = collectState(tradeModel(withIdleActions<TradeActions>({
        onExecutionBatch$: publicExecutions$,
        onMyExecutionCreated$: privateExecutions$,
    })));

    Array.from({ length: HISTORY_LIMIT + 1 }, (_, size) =>
        privateExecutions$.shamefullySendNext({ ...execution, side: "BUY", size }),
    );
    const histories = state().histories;
    assert.deepEqual(histories.map((entry) => entry.description),
        Array.from({ length: HISTORY_LIMIT }, (_, index) => `BUY / ${HISTORY_LIMIT - index} / MARKET`));

    let timeFormats = 0;
    histories[0].createdAt.toLocaleTimeString = () => {
        timeFormats += 1;
        return "12:34:56";
    };
    const summary$ = Stream.create<SummaryState>();
    const rendered: VNode[] = [];
    view(summary$).addListener({ next: (node) => rendered.push(node) });
    const render = () => summary$.shamefullySendNext({ ...state(), collateral: 0, marketState: { health: "", state: "" } });

    render();
    publicExecutions$.shamefullySendNext([{ side: "BUY", price: 41 }, { side: "SELL", price: 42 }]);
    render();

    const list = child(rendered[0], "ul.histories");
    assert.equal(list.children?.length, HISTORY_LIMIT);
    assert.equal(child(rendered[1], "ul.histories"), list);
    assert.equal(child(child(rendered[1], "div.current-price"), "span.number").text, "42");
    assert.equal(timeFormats, 1);

    privateExecutions$.shamefullySendNext({ ...execution, side: "SELL", size: 1 });
    render();

    const updatedList = child(rendered[2], "ul.histories");
    assert.notEqual(updatedList, list);
    assert.equal(updatedList.children?.length, HISTORY_LIMIT);
    assert.equal(child(child(updatedList, "li.history"), "span.description").text, "SELL / 1 / MARKET");
});
