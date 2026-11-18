const assert = require("node:assert/strict");
const {test} = require("node:test");
const Stream = require("xstream").default;
const {twapIntent} = require("../src/components/trade/order/twapIntent");
const {twapModel} = require("../src/components/trade/order/twapModel");
const {twapRequest} = require("../src/components/trade/order/twapRequest");
const {canStart, defaultTwapOrder} = require("../src/models/twapOrder");

function setup(t, savedInterval, interval = defaultTwapOrder.interval) {
    const buy$ = Stream.create();
    const sell$ = Stream.create();
    const dom = { select: () => dom, events: () => Stream.never() };
    const actions = {
        ...twapIntent({
            DOM: dom,
            HTTP: { select: () => Stream.never() },
            storage: { local: { getItem: (key) => Stream.of(key === "twap-interval" ? savedInterval : null) } },
        }),
        onClickTwapBuyButton$: buy$,
        onClickTwapSellButton$: sell$,
    };
    let state = { size: 0.03, twap: { ...defaultTwapOrder, interval, slices: 3 } };
    const state$ = Stream.createWithMemory();
    state$.shamefullySendNext(state);
    const modelSubscription = twapModel(actions).subscribe({
        next: (reducer) => {
            state = reducer(state);
            state$.shamefullySendNext(state);
        },
    });
    const requests = [];
    const requestSubscription = twapRequest(actions, state$).subscribe({
        next: (request) => requests.push(request),
    });
    t.after(() => {
        modelSubscription.unsubscribe();
        requestSubscription.unsubscribe();
    });
    return { buy$, sell$, requests, getState: () => state };
}

test("TWAP start eligibility respects the browser timer limit", () => {
    const eligible = (interval) => canStart({ ...defaultTwapOrder, interval, slices: 3 }, 0.03);
    assert.equal(eligible(2147483.647), true);
    for (const interval of [2147483.648, 2147484, Number.MAX_VALUE, Infinity, -Infinity, NaN, 0, -1]) {
        assert.equal(eligible(interval), false, String(interval));
    }
});

test("invalid saved intervals keep TWAP idle with no order requests", (t) => {
    for (const interval of ["2147484", "Infinity", "-Infinity", "NaN"]) {
        const { buy$, sell$, requests, getState } = setup(t, interval);
        assert.equal(canStart(getState().twap, 0.03), false, interval);
        buy$.shamefullySendNext(null);
        sell$.shamefullySendNext(null);
        assert.equal(getState().twap.remaining, 0, interval);
        assert.deepEqual(requests, [], interval);
    }
});

test("the scheduler rejects invalid intervals even when directly supplied in state", (t) => {
    for (const interval of [2147484, Number.MAX_VALUE, Infinity, NaN]) {
        const { buy$, sell$, requests, getState } = setup(t, null, interval);
        buy$.shamefullySendNext(null);
        sell$.shamefullySendNext(null);
        assert.equal(getState().twap.remaining, 0, String(interval));
        assert.deepEqual(requests, [], String(interval));
    }
});

test("a valid saved interval submits the first slice immediately and spaces the rest", (t) => {
    const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: { "api-key": "test-key", "api-secret": "test-secret" },
    });
    t.after(() => {
        if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
        else delete globalThis.localStorage;
    });
    t.mock.timers.enable({ apis: ["setInterval"] });
    const { buy$, requests, getState } = setup(t, "2.5");
    assert.equal(getState().twap.interval, 2.5);

    buy$.shamefullySendNext(null);
    assert.equal(requests.length, 1);
    t.mock.timers.tick(2499);
    assert.equal(requests.length, 1);
    t.mock.timers.tick(1);
    assert.equal(requests.length, 2);
    t.mock.timers.tick(2499);
    assert.equal(requests.length, 2);
    t.mock.timers.tick(1);
    t.mock.timers.tick(2500);
    assert.deepEqual(requests.map(({ category, send }) => {
        const { side, size } = JSON.parse(send);
        return [category, side, size];
    }), [
        ["twap-order", "BUY", 0.01],
        ["twap-order", "BUY", 0.01],
        ["twap-order", "BUY", 0.01],
    ]);
});
