import {deepStrictEqual} from "node:assert";
import {test} from "node:test";
import Stream from "xstream";
import type {Sources, State} from "../src/components/trade";
import {intent} from "../src/components/trade/intent";
import {model} from "../src/components/trade/model";

const response = (body: object) => ({ text: JSON.stringify(body) });
const stopDetail = (id: number, price: number) => response({
    parent_order_id: id,
    parameters: [{ condition_type: "STOP", side: "SELL", size: 0.1, trigger_price: price }],
});

[false, true].forEach((reverse) => {
    test(`keeps both stop markers when details resolve ${reverse ? "in reverse order" : "in request order"}`, () => {
        const activeOrders$ = Stream.create<ReturnType<typeof response>>();
        const details$ = Stream.create<Stream<ReturnType<typeof response>>>();
        const first$ = Stream.create<ReturnType<typeof response>>();
        const second$ = Stream.create<ReturnType<typeof response>>();
        const sources = {
            HTTP: {
                select: (category: string) => {
                    if (category === "parent-orders") { return Stream.of(activeOrders$); }
                    if (category === "parent-order") { return details$; }
                    return Stream.never();
                },
            },
            socket: {
                childOrderEvent$: Stream.never(),
                execution$: Stream.never(),
                parentOrderEvent$: Stream.never(),
            },
        } as unknown as Sources;
        let state: State | undefined;
        const subscription = model(intent(sources)).subscribe({
            next: (reducer) => { state = reducer(state); },
        });

        try {
            activeOrders$.shamefullySendNext(response([{ parent_order_id: 1 }, { parent_order_id: 2 }]));
            deepStrictEqual(state?.parentStopOrders, {});
            deepStrictEqual(state?.stopOrders, []);
            details$.shamefullySendNext(first$);
            details$.shamefullySendNext(second$);

            const resolveFirst = () => first$.shamefullySendNext(stopDetail(1, 100));
            const resolveSecond = () => second$.shamefullySendNext(stopDetail(2, 200));
            (reverse ? [resolveSecond, resolveFirst] : [resolveFirst, resolveSecond]).forEach((resolve) => resolve());

            deepStrictEqual(state?.parentStopOrders[1]?.map((order) => order.price), [100]);
            deepStrictEqual(state?.parentStopOrders[2]?.map((order) => order.price), [200]);
            deepStrictEqual(state?.stopOrders.map((order) => order.price).sort((a, b) => a - b), [100, 200]);
        } finally {
            subscription.unsubscribe();
        }
    });
});
