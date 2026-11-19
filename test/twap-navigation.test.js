const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { setImmediate: flush } = require("node:timers/promises");
const { withState } = require("@cycle/state");
const { routerify } = require("cyclic-router");
const { buildSync } = require("esbuild");
const switchPath = require("switch-path").default;
const Stream = require("xstream").default;

const loadRoot = () => {
    const { outputFiles: [bundle] } = buildSync({
        absWorkingDir: path.resolve(__dirname, ".."),
        entryPoints: ["src/components/index.ts"],
        bundle: true,
        loader: { ".styl": "empty" },
        external: ["xstream", "xstream/*"],
        platform: "node",
        write: false,
    });
    const entry = { exports: {} };
    const evaluate = new Function("require", "module", "localStorage", "window", bundle.text);
    evaluate(require, entry, { "api-key": "test-key", "api-secret": "test-secret" }, {});
    return entry.exports.Root;
};

const findNode = (node, selector) => {
    if (node?.sel === selector) return node;
    return node?.children?.map((child) => findNode(child, selector)).find(Boolean);
};

test("leaving Trade stops a partially completed TWAP and restores idle controls", async (t) => {
    t.mock.timers.enable({ apis: ["setInterval"] });

    const history = Stream.create();
    const buy = Stream.create();
    const changeSlices = Stream.create();
    const changeInterval = Stream.create();
    const twapResponses = Stream.create();
    const requests = [];
    const events = {
        ".twap-order-buttons .buy-button click": buy,
        "#twap-slices-input input": changeSlices,
        "#twap-interval-input input": changeInterval,
    };
    const dom = (scope = "") => ({
        select: (selector) => dom(scope + selector + " "),
        events: (type) => events[scope + type] ?? Stream.never(),
    });

    let state;
    let view;
    const Root = loadRoot();
    const app = routerify(withState((sources) => {
        sources.state.stream.addListener({ next: (value) => { state = value; } });
        return Root(sources);
    }), switchPath);
    const sinks = app({
        DOM: dom(),
        HTTP: { select: (category) => category === "twap-order" ? twapResponses : Stream.never() },
        history,
        socket: {
            board$: Stream.never(),
            childOrderEvent$: Stream.never(),
            execution$: Stream.never(),
            executionBatch$: Stream.never(),
            parentOrderEvent$: Stream.never(),
            reconnect$: Stream.never(),
        },
        storage: { local: { getItem: (key) => Stream.of(key === "order-size" ? "0.03" : null) } },
    });
    const http = sinks.HTTP.subscribe({
        next: (request) => { if (request?.category === "twap-order") requests.push(request); },
    });
    const rendering = sinks.DOM.subscribe({ next: (node) => { view = node; } });
    t.after(() => {
        http.unsubscribe();
        rendering.unsubscribe();
    });

    history.shamefullySendNext({ pathname: "/" });
    await flush();
    changeSlices.shamefullySendNext({ target: { value: "3" } });
    changeInterval.shamefullySendNext({ target: { value: "2" } });
    await flush();

    buy.shamefullySendNext(null);
    assert.equal(requests.length, 1);
    const response = { request: requests[0] };
    twapResponses.shamefullySendNext(Object.assign(Stream.of(response), response));
    await flush();
    assert.equal(findNode(view, "p.twap-status").text, "Running: 2 / 3 slices left");

    history.shamefullySendNext({ pathname: "/setting" });
    await flush();
    assert.deepEqual(state.trade.orderComponentState.twap, { interval: 2, remaining: 0, slices: 3 });
    t.mock.timers.tick(4000);
    assert.equal(requests.length, 1);

    history.shamefullySendNext({ pathname: "/" });
    await flush();
    const buttons = findNode(view, "div.twap-order-buttons.order-buttons").children;
    assert.deepEqual(buttons.map(({ sel, data }) => [sel, data.attrs.disabled]), [
        ["button.sell-button", false],
        ["button.buy-button", false],
    ]);
    assert.equal(state.trade.histories.length, 1);
    t.mock.timers.tick(2000);
    assert.equal(requests.length, 1);

    buy.shamefullySendNext(null);
    await flush();
    assert.equal(requests.length, 2);
    assert.equal(findNode(view, "p.twap-status").text, "Running: 3 / 3 slices left");
});
