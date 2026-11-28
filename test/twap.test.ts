import type {VNode} from "@cycle/dom";
import type {HTTPSource, RequestOptions} from "@cycle/http";
import {deepStrictEqual, strictEqual} from "node:assert";
import {before, test, TestContext} from "node:test";
import Stream from "xstream";
import {State} from "../src/components/trade/order";
import {intent} from "../src/components/trade/order/intent";
import {model} from "../src/components/trade/order/model";
import {orderRequests} from "../src/components/trade/order/request";
import {TwapActions, TwapSchedule} from "../src/components/trade/order/twapIntent";
import {view} from "../src/components/trade/order/view";
import {twapSection} from "../src/components/trade/order/twapView";
import {twapRequest} from "../src/components/trade/order/twapRequest";
import {Sources} from "../src/components/trade";
import {hasApiCredentials, initializeCredentials} from "../src/credentials";
import {unsignedRequests$} from "../src/drivers/httpDriver";
import {TwapSliceRequest} from "../src/http";
import {minimumOrderSize} from "../src/models/order";
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

test("settles overlapping slices and returns to idle in either response order", async (context) => {
    await Promise.all([[0, 1], [1, 0]].map(([first, second]) =>
        context.test(`slice ${first + 1} resolves first`, (subtest) => {
            const twap = createTwap(subtest);
            twap.buy.shamefullySendNext(null);
            subtest.mock.timers.tick(1000);
            strictEqual(twap.requests.length, 2);

            twap.requests[first].succeed();
            strictEqual(twap.state.twap.remaining, 1);

            twap.requests[second].succeed();
            strictEqual(isRunning(twap.state.twap), false);
        }),
    ));
});

test("spaces three dispatches after a delayed first signature", (context) => {
    const twap = createTwap(context, 1, 3, { delayFirstSignature: true });
    twap.setSize("0.03000002");
    twap.buy.shamefullySendNext(null);

    context.mock.timers.tick(2500);
    strictEqual(twap.requests.length, 1);
    deepStrictEqual(twap.dispatches, []);
    twap.dispatch(twap.requests[0]);
    deepStrictEqual(twap.dispatches, [[2500, 0.01000001]]);
    context.mock.timers.tick(999);
    strictEqual(twap.dispatches.length, 1);
    context.mock.timers.tick(1);
    deepStrictEqual(twap.dispatches, [[2500, 0.01000001], [3500, 0.01000001]]);
    context.mock.timers.tick(999);
    strictEqual(twap.dispatches.length, 2);
    context.mock.timers.tick(1);
    deepStrictEqual(twap.dispatches, [[2500, 0.01000001], [3500, 0.01000001], [4500, 0.01]]);

    strictEqual(twap.state.twap.remaining, 3);
    [...twap.requests].reverse().forEach(({ succeed }) => succeed());
    strictEqual(isRunning(twap.state.twap), false);
});

test("discards later slices once an earlier slice fails to sign", (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const start$ = Stream.create<TwapSchedule>();
    const http = { select: () => Stream.never() } as unknown as HTTPSource;
    const requests: TwapSliceRequest[] = [];
    const { requests$ } = twapRequest(
        { onTwapStarted$: start$, onClickTwapCancelButton$: Stream.never() } as unknown as TwapActions,
        Stream.of({ size: 0.03, twap: { interval: 1, slices: 3 } } as unknown as State),
        http,
    );
    const subscription = requests$.subscribe({ next: (request) => requests.push(request) });
    context.after(() => subscription.unsubscribe());

    start$.shamefullySendNext({ id: Symbol(), side: "BUY" });
    strictEqual(requests.length, 1);

    unsignedRequests$.shamefullySendNext(requests[0]);
    context.mock.timers.tick(2000);
    strictEqual(requests.length, 1);
});

for (const slices of [1, 2]) {
    test(`settles a ${slices}-slice TWAP when signing the final slice fails`, async (context) => {
        const twap = createTwap(context, 1, slices, {
            rejectFinalSignature: async (request) => {
                unsignedRequests$.shamefullySendNext(await Promise.resolve(request));
            },
        });
        twap.buy.shamefullySendNext(null);
        if (slices === 2) {
            twap.requests[0].succeed();
            context.mock.timers.tick(1000);
        }
        strictEqual(twap.state.twap.remaining, 1);

        await Promise.resolve();
        strictEqual(isRunning(twap.state.twap), false);
        strictEqual(twap.state.twap.scheduleId, undefined);
        const status = twapSection(twap.state, hasApiCredentials()).children!
            .find((node): node is VNode => typeof node === "object" && node?.sel === "p.twap-status");
        strictEqual(status?.text, "TWAP stopped because an order could not be signed.");
        strictEqual(twap.requests.length, slices - 1);
    });
}

test("ignores a canceled schedule's response when tracking replacement progress", (context) => {
    const twap = createTwap(context);
    twap.buy.shamefullySendNext(null);
    twap.cancel.shamefullySendNext(null);
    context.mock.timers.tick(1000);
    strictEqual(twap.requests.length, 1);
    strictEqual(isRunning(twap.state.twap), false);

    twap.sell.shamefullySendNext(null);
    twap.requests[0].succeed();
    strictEqual(twap.state.twap.remaining, 2);

    context.mock.timers.tick(1000);
    twap.requests[1].disconnect();
    strictEqual(twap.state.twap.remaining, 1);
    twap.requests[2].succeed();
    strictEqual(isRunning(twap.state.twap), false);
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

test("previews and submits every unit of an uneven TWAP split", (context) => {
    const twap = createTwap(context, 1, 3);
    twap.setSize("0.031");
    const status = twapSection(twap.state, hasApiCredentials()).children!
        .find((node): node is VNode => typeof node === "object" && node?.sel === "p.twap-status");
    strictEqual(status?.text, "0.01033334 x 1 + 0.01033333 x 2 every 1 sec");

    twap.buy.shamefullySendNext(null);
    twap.setSize("0.06");
    context.mock.timers.tick(1000);
    context.mock.timers.tick(1000);
    const sizes = twap.requests.map(({ response$ }) => JSON.parse(response$.request.send as string).size);
    deepStrictEqual(sizes, [0.01033334, 0.01033333, 0.01033333]);
    strictEqual(sizes.every((size) => size >= minimumOrderSize), true);
    strictEqual(sizes.reduce((total, size) => total + Math.round(size * 1e8), 0), 3100000);
});

test("manual market orders and one-slice TWAP share the same minimum", (context) => {
    const twap = createTwap(context, 1, 1);
    const manualRequests: RequestOptions[] = [];
    const submission = orderRequests(twap.actions, twap.state$).subscribe({
        next: ({ requests }) => manualRequests.push(...requests as RequestOptions[]),
    });
    let orderView: VNode;
    const rendering = view(twap.state$).subscribe({ next: (node) => { orderView = node; } });
    context.after(() => { submission.unsubscribe(); rendering.unsubscribe(); });

    const disabled = (selector: string) => orderView.children!
        .flatMap((section) => (section as VNode).children ?? [])
        .filter((node) => (node as VNode).sel === `div.${selector}.order-buttons`)
        .flatMap((node) => (node as VNode).children!)
        .map((button) => (button as VNode).data!.attrs!.disabled);

    twap.setSize("0.0009");
    deepStrictEqual(disabled("market-order-buttons"), [true, true]);
    deepStrictEqual(disabled("twap-order-buttons"), [true, true]);
    [twap.marketBuy, twap.marketSell, twap.buy, twap.sell].forEach((click) => click.shamefullySendNext(null));
    strictEqual(manualRequests.length, 0);
    strictEqual(twap.requests.length, 0);

    twap.setSize("0.001");
    deepStrictEqual(disabled("market-order-buttons"), [false, false]);
    deepStrictEqual(disabled("twap-order-buttons"), [false, false]);
    [twap.marketBuy, twap.marketSell, twap.buy].forEach((click) => click.shamefullySendNext(null));
    deepStrictEqual(manualRequests.map(({ send }) => JSON.parse(send as string).size), [0.001, 0.001]);
    deepStrictEqual(twap.requests.map(({ response$ }) => JSON.parse(response$.request.send as string).size), [0.001]);
});

const createTwap = (
    context: TestContext, interval = 1, slices = 2,
    { delayFirstSignature = false, rejectFinalSignature }: {
        delayFirstSignature?: boolean;
        rejectFinalSignature?: (request: TwapSliceRequest) => void;
    } = {},
) => {
    context.mock.timers.enable({ apis: ["Date", "setTimeout"] });
    const buy = Stream.create<null>();
    const cancel = Stream.create<null>();
    const sell = Stream.create<null>();
    const clicks = { ".buy-button": buy, ".cancel-button": cancel, ".sell-button": sell };
    const marketBuy = Stream.create<null>();
    const marketSell = Stream.create<null>();
    const marketClicks: Partial<typeof clicks> = { ".buy-button": marketBuy, ".sell-button": marketSell };
    const buttonClicks = { ".twap-order-buttons": clicks, ".market-order-buttons": marketClicks };
    const inputs = {
        "#size-input": Stream.create<{target: {value: string}}>(),
        "#twap-interval-input": Stream.create<{target: {value: string}}>(),
        "#twap-slices-input": Stream.create<{target: {value: string}}>(),
    };
    const responses$ = Stream.create<ReturnType<typeof fakeResponse>["response$"]>();
    const sources = {
        DOM: {
            select: (container: string) => ({
                events: () => inputs[container as keyof typeof inputs] ?? Stream.never(),
                select: (selector: ".buy-button" | ".sell-button" | ".cancel-button") => ({
                    events: () => buttonClicks[container as keyof typeof buttonClicks]?.[selector] ?? Stream.never(),
                }),
            }),
        },
        HTTP: { select: (category: string) => category === "twap-order" ? responses$ : Stream.never() },
        storage: { local: { getItem: () => Stream.never() } },
    } as unknown as Sources;

    const state$ = Stream.createWithMemory<State>();
    const actions = intent(sources, state$);
    let state: State | undefined;
    const scheduler = twapRequest(actions, state$, sources.HTTP);
    const reducer = model(actions, Stream.never(), scheduler.lifecycle$).subscribe({
        next: (reduce) => {
            state = reduce(state);
            if (state) { state$.shamefullySendNext(state); }
        },
    });
    state = { ...state!, size: 0.01 * slices, twap: { ...state!.twap, interval, slices } };
    state$.shamefullySendNext(state);

    const requests: Array<ReturnType<typeof fakeResponse>> = [];
    const dispatches: Array<[number, number]> = [];
    const dispatch = ({ response$ }: ReturnType<typeof fakeResponse>) => {
        dispatches.push([Date.now(), JSON.parse(response$.request.send as string).size]);
        responses$.shamefullySendNext(response$);
    };
    const request = scheduler.requests$.subscribe({
        next: (input) => {
            if (rejectFinalSignature && requests.length === slices - 1) {
                rejectFinalSignature(input);
                return;
            }
            const pending = fakeResponse(input);
            requests.push(pending);
            if (!delayFirstSignature || requests.length > 1) { dispatch(pending); }
        },
    });
    context.after(() => { request.unsubscribe(); reducer.unsubscribe(); });
    return {
        actions, state$, buy, cancel, sell, marketBuy, marketSell, requests, dispatches, dispatch,
        setSize: (value: string) => inputs["#size-input"].shamefullySendNext({target: {value}}),
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
        disconnect: () => response$.shamefullySendError(new Error("Network error")),
        succeed: () => {
            response$.shamefullySendNext({ request });
            response$.shamefullySendNext({ request });
            response$.shamefullySendComplete();
        },
    };
};
