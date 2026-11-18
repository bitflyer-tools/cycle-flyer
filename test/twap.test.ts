import {strict as assert} from "node:assert";
import {test} from "node:test";
import Stream from "xstream";
import type {RequestInput} from "@cycle/http";
import type {State} from "../src/components/trade/order";
import type {OrderHistory} from "../src/models/orderHistory";
import {IFDOCOrder} from "../src/models/ifdocoOrder";
import {Position} from "../src/models/position";
import {twapModel} from "../src/components/trade/order/twapModel";
import {twapRequest} from "../src/components/trade/order/twapRequest";
import {twapSection} from "../src/components/trade/order/twapView";
import {defaultTwapOrder} from "../src/models/twapOrder";

test("TWAP progress and requests use the starting schedule after inputs change", ({ mock }) => {
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: { "api-key": "test", "api-secret": "test" },
    });
    mock.timers.enable({ apis: ["setInterval"] });

    const actions = {
        onClickTwapBuyButton$: Stream.create<null>(),
        onClickTwapCancelButton$: Stream.never<null>(),
        onClickTwapSellButton$: Stream.create<null>(),
        onTwapIntervalChanged$: Stream.create<number>(),
        onTwapIntervalLoaded$: Stream.never<number>(),
        onTwapSliceCreated$: Stream.create<OrderHistory>(),
        onTwapSlicesChanged$: Stream.create<number>(),
        onTwapSlicesLoaded$: Stream.never<number>(),
    };
    let state: State = {
        currentPrice: 0,
        histories: [],
        ifdocoOrder: new IFDOCOrder(10000, 50),
        isOrdering: false,
        orders: [],
        parentStopOrders: {},
        position: new Position([]),
        price: 0,
        size: 0.3,
        triggerPrice: 0,
        twap: { ...defaultTwapOrder, interval: 10, slices: 3 },
    };
    const state$ = Stream.create<State>().startWith(state);
    twapModel(actions).addListener({
        next: (reduce) => {
            state = reduce(state)!;
            state$.shamefullySendNext(state);
        },
    });
    const requests: RequestInput[] = [];
    twapRequest(actions, state$).addListener({
        error: (error) => { throw error; },
        next: (request) => requests.push(request),
    });
    const status = () => (twapSection(state).children ?? [])
        .flatMap((node) => typeof node === "object" && node?.sel === "p.twap-status" ? [node.text] : []);
    const completeSlice = () => actions.onTwapSliceCreated$.shamefullySendNext({
        createdAt: new Date(), description: "", name: "TWAP", status: "success",
    });

    actions.onClickTwapBuyButton$.shamefullySendNext(null);
    assert.equal(requests.length, 1);
    completeSlice();
    actions.onTwapSlicesChanged$.shamefullySendNext(1);
    actions.onTwapIntervalChanged$.shamefullySendNext(1);
    assert.deepEqual(status(), ["Running: 2 / 3 slices left", "Schedule edits apply to the next TWAP."]);

    mock.timers.tick(9999);
    assert.equal(requests.length, 1);
    mock.timers.tick(1);
    assert.equal(requests.length, 2);
    completeSlice();
    assert.equal(status()[0], "Running: 1 / 3 slices left");
    mock.timers.tick(10000);
    assert.equal(requests.length, 3);
    completeSlice();
    assert.deepEqual(status(), ["0.3 x 1 every 1 sec"]);

    actions.onClickTwapSellButton$.shamefullySendNext(null);
    assert.equal(requests.length, 4);
    assert.equal(status()[0], "Running: 1 / 1 slices left");
    completeSlice();
    mock.timers.tick(10000);
    assert.equal(requests.length, 4);
});
