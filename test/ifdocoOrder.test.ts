import {strict as assert} from "node:assert";
import {test} from "node:test";
import {State} from "../src/components/trade/order/index";
import {ifdocoOrder} from "../src/http";
import {IFDOCOrder} from "../src/models/ifdocoOrder";
import {defaultAccountType} from "../src/models/order";
import {Position} from "../src/models/position";
import {defaultTwapOrder} from "../src/models/twapOrder";

Object.defineProperty(globalThis, "localStorage", {
    value: { "api-key": "test-key", "api-secret": "test-secret" },
});

const currentPrice = 5000000;
const ifdoco = new IFDOCOrder(10000, 50);
const state: State = {
    accountType: defaultAccountType,
    currentPrice,
    histories: [],
    ifdocoOrder: ifdoco,
    isOrdering: false,
    orders: [],
    position: new Position([]),
    price: 0,
    size: 0.01,
    parentStopOrders: {},
    triggerPrice: 0,
    twap: defaultTwapOrder,
};

test("IFDOCO renders the same preview for negative and positive sizes", async () => {
    Object.defineProperty(globalThis, "window", { value: {} });
    const { ifdocoSection } = await import("../src/components/trade/order/ifdocoView");
    const positive = ifdocoSection(state);
    const negative = ifdocoSection({ ...state, size: -state.size });

    assert.deepEqual(negative.children?.[1], positive.children?.[1]);
});

test("IFDOCO submits the same positive size for all legs on both sides", () => {
    const orders = [
        { side: "BUY", profit: ifdoco.buyProfitLine(currentPrice), loss: ifdoco.buyLossLine(currentPrice) },
        { side: "SELL", profit: ifdoco.sellProfitLine(currentPrice), loss: ifdoco.sellLossLine(currentPrice) },
    ];

    orders.forEach(({ side, profit, loss }) => {
        const request = ifdocoOrder(profit, loss, 0.01, side);
        assert(typeof request === "object" && typeof request.send === "string");
        const { parameters } = JSON.parse(request.send);
        assert.deepEqual(parameters.map((leg: { size: number }) => leg.size), [0.01, 0.01, 0.01], side);
    });
});
