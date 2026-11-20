const assert = require("node:assert/strict");
const {test} = require("node:test");
const Stream = require("xstream").default;
const {ifdocoSection} = require("../src/components/trade/order/ifdocoView");
const {intent, storageKeys} = require("../src/components/trade/order/intent");
const {model} = require("../src/components/trade/order/model");
const {orderRequests} = require("../src/components/trade/order/request");

function setup(t, storedWidth, storedSize = "1", currentPrice = 10000000) {
    const widthInput$ = Stream.create();
    const ratioInput$ = Stream.create();
    const sizeInput$ = Stream.create();
    const buyClick$ = Stream.create();
    const sellClick$ = Stream.create();
    const events = {
        "#price-width-input": widthInput$,
        "#ratio-input": ratioInput$,
        "#size-input": sizeInput$,
        ".ranged-ifdoco-order-buttons .buy-button": buyClick$,
        ".ranged-ifdoco-order-buttons .sell-button": sellClick$,
    };
    const dom = (path = []) => ({
        select: (selector) => dom(path.concat(selector)),
        events: () => events[path.join(" ")] || Stream.never(),
    });
    const storage = { [storageKeys.priceWidth]: storedWidth, [storageKeys.size]: storedSize };
    const state$ = Stream.createWithMemory();
    const actions = intent({
        DOM: dom(),
        HTTP: { select: () => Stream.never() },
        storage: { local: { getItem: (key) => Stream.of(storage[key] ?? null) } },
    }, state$);
    let state;
    const reducers = model(actions, Stream.never()).subscribe({
        next: (reduce) => {
            state = { ...reduce(state), currentPrice };
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
        enterRatio: (value) => ratioInput$.shamefullySendNext({ target: { value } }),
        enterSize: (value) => sizeInput$.shamefullySendNext({ target: { value } }),
        enterWidth: (value) => widthInput$.shamefullySendNext({ target: { value } }),
        setCurrentPrice: (price) => {
            currentPrice = price;
            state = { ...state, currentPrice };
            state$.shamefullySendNext(state);
        },
        requests,
        view: () => ifdocoSection(state),
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

for (const size of ["-0.05", "0", "NaN", "Infinity", "-Infinity"]) {
    test(`IFDOCO rejects a size of ${size} from input and storage`, (t) => {
        const form = setup(t, "10000", size);
        assert.deepEqual(form.disabled(), [true, true]);
        form.clickBoth();
        assert.deepEqual(form.requests, []);

        form.enterSize("0.05");
        assert.deepEqual(form.disabled(), [false, false]);
        form.enterSize(size);
        assert.deepEqual(form.disabled(), [true, true]);
        form.clickBoth();
        assert.deepEqual(form.requests, []);
    });
}

test("IFDOCO requires a positive finite market reference price for both sides", (t) => {
    const form = setup(t, "10000", "1", 0);
    for (const price of [0, -1, NaN, Infinity, -Infinity]) {
        form.setCurrentPrice(price);
        assert.deepEqual(form.disabled(), [true, true]);
        form.clickBoth();
        assert.deepEqual(form.requests, []);
    }

    form.setCurrentPrice(10000000);
    assert.deepEqual(form.disabled(), [false, false]);
    form.clickBoth();
    assert.equal(form.requests.length, 2);
});

test("IFDOCO rejects invalid ratios and restores the preview and both submissions at 50", (t) => {
    const form = setup(t, "10000");
    for (const ratio of ["abc", "Infinity", "-Infinity"]) {
        form.enterRatio(ratio);
        const preview = form.view().children.find(({ sel }) => sel === "div.line");
        const ratioField = form.view().children.find(({ sel }) => sel === "div.ratio").children[1];
        assert.equal(preview.children[0].sel, "p#ratio-error");
        assert.equal(ratioField.data.attrs["aria-invalid"], "true");
        assert.deepEqual(form.disabled(), [true, true]);
        form.clickBoth();
        assert.deepEqual(form.requests, []);
    }

    form.enterRatio("50");
    const preview = form.view().children.find(({ sel }) => sel === "div.line");
    assert.equal(preview.children[0].sel, "p.line-number");
    const buyPreview = preview.children[0].children[0].children[1];
    assert.deepEqual(
        buyPreview.children.filter(({ sel }) => sel === "span.profit-line" || sel === "span.loss-line")
            .map(({ text }) => text),
        ["5000", "5000"],
    );
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

test("IFDOCO sends the entered size on all three legs for each side", (t) => {
    const form = setup(t, "10000");
    form.enterSize("0.05");
    assert.deepEqual(form.disabled(), [false, false]);
    form.clickBoth();

    assert.deepEqual(form.requests.map(({ method, url, send }) => {
        assert.equal(method, "POST");
        assert.equal(new URL(url).pathname, "/v1/me/sendparentorder");
        const body = JSON.parse(send);
        assert.equal(body.order_method, "IFDOCO");
        assert.deepEqual(body.parameters.map(({ size }) => size), [0.05, 0.05, 0.05]);
        return body.parameters.map(({ condition_type, side, price, trigger_price }) =>
            [condition_type, side, price ?? trigger_price]);
    }), [
        [["MARKET", "BUY", undefined], ["LIMIT", "SELL", 10005000], ["STOP", "SELL", 9995000]],
        [["MARKET", "SELL", undefined], ["LIMIT", "BUY", 9995000], ["STOP", "BUY", 10005000]],
    ]);
});
