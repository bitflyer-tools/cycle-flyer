import {RequestOptions, Response} from "@cycle/http";
import {strict as assert} from "node:assert";
import {test} from "node:test";
import Stream from "xstream";
import {intent} from "../src/components/trade/order/intent";
import {model} from "../src/components/trade/order/model";
import {State} from "../src/components/trade/order";
import {Sources} from "../src/components/trade";

const cases = [
    {
        category: "market-order",
        container: ".market-order-buttons",
        payload: { side: "BUY", size: 0.1 },
        entries: [["Market", "BUY / 0.1 / MARKET"]],
        locksControls: true,
    },
    {
        category: "stop-order",
        container: ".stop-order-buttons",
        payload: { parameters: [{ condition_type: "STOP", side: "BUY", size: 0.1, trigger_price: 800 }] },
        entries: [["Stop", "BUY / 0.1 / 800"]],
        locksControls: true,
    },
    {
        category: "ifdoco-order",
        container: ".ranged-ifdoco-order-buttons",
        payload: {
            parameters: [
                { condition_type: "MARKET", side: "BUY", size: 0.1 },
                { condition_type: "LIMIT", side: "SELL", size: 0.1, price: 900 },
                { condition_type: "STOP", side: "SELL", size: 0.1, trigger_price: 800 },
            ],
        },
        entries: [["Stop", "SELL / 0.1 / 800"], ["Limit", "SELL / 0.1 / 900"], ["Market", "BUY / 0.1 / MARKET"]],
        locksControls: false,
    },
];

const responseStream = (request: RequestOptions) =>
    Object.assign(Stream.create<Response>().remember(), { request });

cases.forEach(({ category, container, payload, entries, locksControls }) => {
    test(`${category} records a response-less error and continues handling submissions`, () => {
        const click$ = Stream.create<null>();
        const responses$ = Stream.create<ReturnType<typeof responseStream>>();
        const sources = {
            DOM: {
                select: (scope: string) => ({
                    events: () => Stream.never(),
                    select: (selector: string) => ({
                        events: () => scope === container && selector === ".buy-button" ? click$ : Stream.never(),
                    }),
                }),
            },
            HTTP: { select: (name: string) => name === category ? responses$ : Stream.never() },
            storage: { local: { getItem: () => Stream.never() } },
        } as unknown as Sources;

        let state!: State;
        model(intent(sources)).addListener({
            next: (reducer) => { state = reducer(state); },
            error: (error) => { throw error; },
        });

        const request = { url: "/order", category, send: JSON.stringify(payload) };
        const submit = () => {
            click$.shamefullySendNext(null);
            assert.equal(state.isOrdering, locksControls);
            const response$ = responseStream(request);
            responses$.shamefullySendNext(response$);
            return response$;
        };

        submit().shamefullySendError(new Error("Disconnected"));
        assert.equal(state.isOrdering, false);
        assert.deepEqual(
            state.histories.map(({ name, description, status }) => [name, description, status]),
            entries.map((entry) => [...entry, "unconfirmed"]),
        );

        submit().shamefullySendError(Object.assign(new Error("Rejected"), { response: { status: 400 } }));
        assert.equal(state.isOrdering, false);
        assert.deepEqual(state.histories.map(({ status }) => status), [
            ...entries.map(() => "failed"),
            ...entries.map(() => "unconfirmed"),
        ]);

        const success$ = submit();
        success$.shamefullySendNext({ request } as Response);
        success$.shamefullySendComplete();
        assert.equal(state.isOrdering, false);
        assert.deepEqual(state.histories.map(({ status }) => status), [
            ...entries.map(() => "success"),
            ...entries.map(() => "failed"),
            ...entries.map(() => "unconfirmed"),
        ]);
    });
});
