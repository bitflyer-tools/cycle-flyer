const assert = require("node:assert/strict");
const {test} = require("node:test");
const {mockDOMSource} = require("@cycle/dom");
const {MainHTTPSource} = require("@cycle/http/lib/cjs/MainHTTPSource");
const {StateSource} = require("@cycle/state");
const {routerify} = require("cyclic-router");
const switchPath = require("switch-path").default;
const Stream = require("xstream").default;
const {Root} = require("../src/components");
const {parsePriceAlertLevel} = require("../src/components/trade/priceAlert");

function setup(t) {
    const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {} });
    t.after(() => {
        if (storageDescriptor) {
            Object.defineProperty(globalThis, "localStorage", storageDescriptor);
        } else {
            Reflect.deleteProperty(globalThis, "localStorage");
        }
    });
    const submit$ = Stream.create();
    const dismiss$ = Stream.create();
    const execution$ = Stream.create();
    const history$ = Stream.createWithMemory();
    history$.shamefullySendNext({ pathname: "/" });
    const state$ = Stream.createWithMemory();
    const summaryEvents = {
        ".price-alert-form": { submit: submit$ },
        ".dismiss-price-alert": { click: dismiss$ },
    };
    const sinks = routerify(Root, switchPath)({
        DOM: mockDOMSource({ ".___trade": new Proxy({}, {
            get: (_, selector) => typeof selector === "string" && selector.startsWith(".___cycle")
                ? summaryEvents
                : undefined,
        }) }),
        HTTP: new MainHTTPSource(Stream.never(), "HTTP"),
        history: history$,
        socket: {
            board$: Stream.never(),
            childOrderEvent$: Stream.never(),
            execution$,
            parentOrderEvent$: Stream.never(),
        },
        state: new StateSource(state$, "state"),
        storage: { local: { getItem: () => Stream.of("0.01") } },
    });
    let state;
    const sounds = [];
    const subscriptions = [
        sinks.state.subscribe({ next: (reduce) => {
            state = reduce(state);
            state$.shamefullySendNext(state);
        } }),
        sinks.sound.subscribe({ next: (sound) => sounds.push(sound) }),
    ];
    t.after(() => subscriptions.forEach((subscription) => subscription.unsubscribe()));

    return {
        get alert() { return state.trade.summaryComponentState.priceAlert; },
        dismiss: () => dismiss$.shamefullySendNext({}),
        execute: (price) => execution$.shamefullySendNext({ price, side: "BUY" }),
        navigate: (pathname) => history$.shamefullySendNext({ pathname }),
        set: (threshold, direction) => submit$.shamefullySendNext({ target: { elements: {
            namedItem: (name) => name === "threshold" ? { valueAsNumber: threshold } : { value: direction },
        } } }),
        sounds,
    };
}

test("alert levels require a positive whole JPY amount and a crossing direction", () => {
    for (const threshold of [0, -1, 99.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        assert.equal(parsePriceAlertLevel(threshold, "up"), null);
    }
    assert.equal(parsePriceAlertLevel(100, ""), null);
    assert.deepEqual(parsePriceAlertLevel(100, "up"), { threshold: 100, direction: "up" });
});

test("an upward touch disarms the alert and emits one sound", (t) => {
    const trade = setup(t);
    trade.execute(99);
    trade.set(100, "up");
    trade.set(110, "up");
    assert.deepEqual(trade.alert, { threshold: 100, direction: "up", status: "active" });

    trade.execute(100);
    const triggered = trade.alert;
    assert.equal(triggered.status, "triggered");
    assert.equal(triggered.price, 100);
    assert.ok(Number.isFinite(triggered.time.getTime()));

    [101, 100, 99, 100].forEach(trade.execute);
    assert.equal(trade.alert, triggered);
    assert.deepEqual(trade.sounds, ["price-alert"]);
});

test("a downward alert ignores the first execution and the opposite crossing", (t) => {
    const trade = setup(t);
    trade.set(100, "down");
    trade.execute(99);
    trade.execute(101);
    assert.equal(trade.alert.status, "active");

    trade.execute(98);
    assert.equal(trade.alert.price, 98);
    assert.deepEqual(trade.sounds, ["price-alert"]);

    trade.set(97, "down");
    trade.dismiss();
    trade.execute(97);
    assert.equal(trade.alert, null);
    assert.deepEqual(trade.sounds, ["price-alert"]);
});

test("leaving Trade clears the alert and the crossing baseline on return", (t) => {
    const trade = setup(t);
    trade.execute(99);
    trade.set(100, "up");
    trade.navigate("/setting");
    trade.execute(101);
    trade.navigate("/");
    assert.equal(trade.alert, null);

    trade.set(100, "up");
    trade.execute(101);
    assert.equal(trade.alert.status, "active");
    assert.deepEqual(trade.sounds, []);

    trade.execute(99);
    trade.execute(101);
    assert.equal(trade.alert.status, "triggered");
    trade.navigate("/setting");
    trade.navigate("/");
    assert.equal(trade.alert, null);
    assert.deepEqual(trade.sounds, ["price-alert"]);
});
