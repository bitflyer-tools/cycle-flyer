const assert = require("node:assert/strict");
const {test} = require("node:test");
const Stream = require("xstream").default;
const {ifdocoSection} = require("../src/components/trade/order/ifdocoView");
const {intent, storageKeys} = require("../src/components/trade/order/intent");
const {model} = require("../src/components/trade/order/model");
const {orderRequests} = require("../src/components/trade/order/request");

function setup(t, storedWidth) {
    const widthInput$ = Stream.create();
    const buyClick$ = Stream.create();
    const sellClick$ = Stream.create();
    const events = {
        "#price-width-input": widthInput$,
        ".ranged-ifdoco-order-buttons .buy-button": buyClick$,
        ".ranged-ifdoco-order-buttons .sell-button": sellClick$,
    };
    const dom = (path = []) => ({
        select: (selector) => dom(path.concat(selector)),
        events: () => events[path.join(" ")] || Stream.never(),
    });
    const storage = { [storageKeys.priceWidth]: storedWidth, [storageKeys.size]: "1" };
    const actions = intent({
        DOM: dom(),
        HTTP: { select: () => Stream.never() },
        storage: { local: { getItem: (key) => Stream.of(storage[key] ?? null) } },
    });
    const state$ = Stream.createWithMemory();
    let state;
    const reducers = model(actions, Stream.never()).subscribe({
        next: (reduce) => {
            state = { ...reduce(state), currentPrice: 10000000 };
            state$.shamefullySendNext(state);
        },
    });
    const localStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: { "api-key": "test-key", "api-secret": "test-secret" },
    });
    t.after(() => {
        if (localStorage) Object.defineProperty(globalThis, "localStorage", localStorage);
        else delete globalThis.localStorage;
    });
    const requests = [];
    const subscription = orderRequests(actions, state$).subscribe({ next: ({ requests: batch }) => requests.push(...batch) });
    t.after(() => {
        subscription.unsubscribe();
        reducers.unsubscribe();
    });
    return {
        clickBoth: () => {
            buyClick$.shamefullySendNext({});
            sellClick$.shamefullySendNext({});
        },
        disabled: () => ifdocoSection(state).children.at(-1).children.map((button) => button.data.attrs.disabled),
        enterWidth: (value) => widthInput$.shamefullySendNext({ target: { value } }),
        requests,
    };
}

for (const width of ["-10000", "0", "NaN", "Infinity", "-Infinity"]) {
    test(`IFDOCO rejects a price width of ${width} from input and storage`, (t) => {
        const form = setup(t, width);
        assert.deepEqual(form.disabled(), [true, true]);
        form.clickBoth();
        assert.deepEqual(form.requests, []);

        form.enterWidth("10000");
        assert.deepEqual(form.disabled(), [false, false]);
        form.enterWidth(width);
        assert.deepEqual(form.disabled(), [true, true]);
        form.clickBoth();
        assert.deepEqual(form.requests, []);
    });
}

test("IFDOCO sends the expected parent order for each side with a positive width", (t) => {
    const form = setup(t, "10000");
    assert.deepEqual(form.disabled(), [false, false]);
    form.clickBoth();

    assert.deepEqual(form.requests.map(({ method, url, send }) => {
        assert.equal(method, "POST");
        assert.equal(new URL(url).pathname, "/v1/me/sendparentorder");
        const body = JSON.parse(send);
        assert.equal(body.order_method, "IFDOCO");
        return body.parameters.map(({ condition_type, side, price, trigger_price }) =>
            [condition_type, side, price ?? trigger_price]);
    }), [
        [["MARKET", "BUY", undefined], ["LIMIT", "SELL", 10005000], ["STOP", "SELL", 9995000]],
        [["MARKET", "SELL", undefined], ["LIMIT", "BUY", 9995000], ["STOP", "BUY", 10005000]],
    ]);
});
