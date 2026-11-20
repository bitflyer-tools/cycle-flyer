import {deepStrictEqual, strictEqual} from "node:assert";
import {test, TestContext} from "node:test";
import Stream from "xstream";
import {State} from "../src/components/trade/order";
import {intent} from "../src/components/trade/order/intent";
import {model} from "../src/components/trade/order/model";
import {twapRequest} from "../src/components/trade/order/twapRequest";
import {Sources} from "../src/components/trade";
import {TwapSliceRequest} from "../src/http";
import {isRunning} from "../src/models/twapOrder";

Object.defineProperty(globalThis, "localStorage", { value: { "api-key": "test", "api-secret": "test" } });

test("records overlapping slices and returns to idle in either response order", async (context) => {
    await Promise.all([[0, 1], [1, 0]].map(([first, second]) =>
        context.test(`slice ${first + 1} resolves first`, (subtest) => {
            const twap = createTwap(subtest);
            twap.buy.shamefullySendNext(null);
            subtest.mock.timers.tick(1000);
            strictEqual(twap.requests.length, 2);

            twap.requests[first].succeed();
            strictEqual(twap.state.twap.remaining, 1);
            strictEqual(twap.state.histories.length, 1);

            twap.requests[second].succeed();
            deepStrictEqual(twap.state.histories.map(({name, status}) => [name, status]),
                [["TWAP", "success"], ["TWAP", "success"]]);
            strictEqual(isRunning(twap.state.twap), false);
        }),
    ));
});

test("records a canceled schedule's response without advancing its replacement", (context) => {
    const twap = createTwap(context);
    twap.buy.shamefullySendNext(null);
    twap.cancel.shamefullySendNext(null);
    context.mock.timers.tick(1000);
    strictEqual(twap.requests.length, 1);
    strictEqual(isRunning(twap.state.twap), false);

    twap.sell.shamefullySendNext(null);
    twap.requests[0].succeed();
    strictEqual(twap.state.twap.remaining, 2);
    deepStrictEqual(twap.state.histories.map(({description, status}) => [description, status]),
        [["BUY / 0.01 / MARKET", "success"]]);

    context.mock.timers.tick(1000);
    twap.requests[1].disconnect();
    strictEqual(twap.state.twap.remaining, 1);
    strictEqual(twap.state.histories.length, 1);
    twap.requests[2].succeed();
    strictEqual(isRunning(twap.state.twap), false);
    deepStrictEqual(twap.state.histories.map(({description}) => description),
        ["SELL / 0.01 / MARKET", "BUY / 0.01 / MARKET"]);
});

test("ignores a new start while a schedule is waiting for responses", (context) => {
    const twap = createTwap(context);
    twap.buy.shamefullySendNext(null);
    context.mock.timers.tick(1000);
    twap.requests[0].succeed();
    twap.sell.shamefullySendNext(null);

    strictEqual(twap.state.twap.remaining, 1);
    strictEqual(twap.requests.length, 2);
    twap.requests[1].succeed();
    strictEqual(isRunning(twap.state.twap), false);
});

const createTwap = (context: TestContext) => {
    context.mock.timers.enable({ apis: ["setInterval"] });
    const buy = Stream.create<null>();
    const cancel = Stream.create<null>();
    const sell = Stream.create<null>();
    const clicks = { ".buy-button": buy, ".cancel-button": cancel, ".sell-button": sell };
    const responses$ = Stream.create<ReturnType<typeof fakeResponse>["response$"]>();
    const sources = {
        DOM: {
            select: (container: string) => ({
                events: () => Stream.never(),
                select: (selector: keyof typeof clicks) => ({
                    events: () => container === ".twap-order-buttons" ? clicks[selector] : Stream.never(),
                }),
            }),
        },
        HTTP: { select: (category: string) => category === "twap-order" ? responses$ : Stream.never() },
        storage: { local: { getItem: () => Stream.never() } },
    } as unknown as Sources;

    const state$ = Stream.createWithMemory<State>();
    const actions = intent(sources, state$);
    let state: State | undefined;
    const reducer = model(actions, Stream.never()).subscribe({
        next: (reduce) => {
            state = reduce(state);
            if (state) { state$.shamefullySendNext(state); }
        },
    });
    state = { ...state!, size: 0.02, twap: { ...state!.twap, interval: 1, slices: 2 } };
    state$.shamefullySendNext(state);

    const requests: Array<ReturnType<typeof fakeResponse>> = [];
    const request = twapRequest(actions, state$).subscribe({
        next: (input) => {
            const pending = fakeResponse(input as TwapSliceRequest);
            requests.push(pending);
            responses$.shamefullySendNext(pending.response$);
        },
    });
    context.after(() => { request.unsubscribe(); reducer.unsubscribe(); });
    return { buy, cancel, sell, requests, get state() { return state!; } };
};

const fakeResponse = (request: TwapSliceRequest) => {
    const response$ = Object.assign(Stream.createWithMemory<{request: TwapSliceRequest}>(), { request });
    return {
        response$,
        disconnect: () => response$.shamefullySendError(new Error("Network error")),
        succeed: () => {
            response$.shamefullySendNext({ request });
            response$.shamefullySendNext({ request });
            response$.shamefullySendComplete();
        },
    };
};
