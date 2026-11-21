import {deepStrictEqual, strictEqual} from "node:assert";
import {before, test, TestContext} from "node:test";
import Stream from "xstream";
import {State} from "../src/components/trade/order";
import {intent} from "../src/components/trade/order/intent";
import {model} from "../src/components/trade/order/model";
import {twapSection} from "../src/components/trade/order/twapView";
import {twapRequest} from "../src/components/trade/order/twapRequest";
import {Sources} from "../src/components/trade";
import {hasApiCredentials, initializeCredentials} from "../src/credentials";
import {TwapSliceRequest} from "../src/http";
import {isRunning} from "../src/models/twapOrder";

before(async () => {
    const storage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: { getItem: () => "test-credential", removeItem() {} },
    });
    try {
        await initializeCredentials();
    } finally {
        if (storage) { Object.defineProperty(globalThis, "localStorage", storage); }
        else { Reflect.deleteProperty(globalThis, "localStorage"); }
    }
});

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
    twap.requests[1].fail();
    strictEqual(twap.state.twap.remaining, 1);
    strictEqual(twap.state.histories[0].status, "failed");
    twap.requests[2].succeed();
    strictEqual(isRunning(twap.state.twap), false);
    deepStrictEqual(twap.state.histories.map(({description}) => description),
        ["SELL / 0.01 / MARKET", "SELL / 0.01 / MARKET", "BUY / 0.01 / MARKET"]);
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

test("uses the starting schedule for progress and requests after inputs change", (context) => {
    const twap = createTwap(context, 10, 3);
    const status = () => (twapSection(twap.state, hasApiCredentials()).children ?? [])
        .flatMap((node) => typeof node === "object" && node?.sel === "p.twap-status" ? [node.text] : []);

    twap.buy.shamefullySendNext(null);
    twap.requests[0].succeed();
    twap.setSlices(1);
    twap.setInterval(1);
    deepStrictEqual(status(), ["Running: 2 / 3 slices left", "Schedule edits apply to the next TWAP."]);

    context.mock.timers.tick(9999);
    strictEqual(twap.requests.length, 1);
    context.mock.timers.tick(1);
    strictEqual(twap.requests.length, 2);
    twap.requests[1].succeed();
    strictEqual(status()[0], "Running: 1 / 3 slices left");
    context.mock.timers.tick(10000);
    strictEqual(twap.requests.length, 3);
    twap.requests[2].succeed();
    deepStrictEqual(status(), ["0.03 x 1 every 1 sec"]);

    twap.sell.shamefullySendNext(null);
    strictEqual(twap.requests.length, 4);
    strictEqual(status()[0], "Running: 1 / 1 slices left");
    twap.requests[3].succeed();
    context.mock.timers.tick(10000);
    strictEqual(twap.requests.length, 4);
});

const createTwap = (context: TestContext, interval = 1, slices = 2) => {
    context.mock.timers.enable({ apis: ["setInterval"] });
    const buy = Stream.create<null>();
    const cancel = Stream.create<null>();
    const sell = Stream.create<null>();
    const clicks = { ".buy-button": buy, ".cancel-button": cancel, ".sell-button": sell };
    const inputs = {
        "#twap-interval-input": Stream.create<{target: {value: string}}>(),
        "#twap-slices-input": Stream.create<{target: {value: string}}>(),
    };
    const responses$ = Stream.create<ReturnType<typeof fakeResponse>["response$"]>();
    const sources = {
        DOM: {
            select: (container: string) => ({
                events: () => inputs[container as keyof typeof inputs] ?? Stream.never(),
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
    state = { ...state!, size: 0.01 * slices, twap: { ...state!.twap, interval, slices } };
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
    return {
        buy, cancel, sell, requests,
        setInterval: (value: number) => inputs["#twap-interval-input"].shamefullySendNext({target: {value: String(value)}}),
        setSlices: (value: number) => inputs["#twap-slices-input"].shamefullySendNext({target: {value: String(value)}}),
        get state() { return state!; },
    };
};

const fakeResponse = (input: TwapSliceRequest) => {
    const request = { ...input, credentialVersion: 0 };
    const response$ = Object.assign(Stream.createWithMemory<{request: TwapSliceRequest}>(), { request });
    return {
        response$,
        fail: () => response$.shamefullySendError(new Error("Network error")),
        succeed: () => {
            response$.shamefullySendNext({ request });
            response$.shamefullySendNext({ request });
            response$.shamefullySendComplete();
        },
    };
};
