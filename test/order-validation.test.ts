import {strictEqual} from "node:assert/strict";
import {test} from "node:test";
import {State} from "../src/components/trade/order";
import {canClearPosition, isValidIFDOCOOrder, isValidLimitOrder, isValidOrderSize, isValidStopOrder} from "../src/components/trade/order/validation";
import {currentCredentialVersion} from "../src/credentials";
import {IFDOCOrder} from "../src/models/ifdocoOrder";
import {defaultAccountType} from "../src/models/order";
import {Position} from "../src/models/position";
import {defaultTwapOrder} from "../src/models/twapOrder";

const baseState = (overrides: Partial<State> = {}): State => ({
    accountType: defaultAccountType,
    currentPrice: 0,
    histories: [],
    ifdocoOrder: new IFDOCOrder(10000, 50),
    isOrdering: false,
    orders: [],
    parentStopOrders: {},
    position: new Position([]),
    price: 0,
    size: 0.001,
    triggerPrice: 0,
    twap: defaultTwapOrder,
    ...overrides,
});

test("isValidOrderSize rejects sizes below the minimum and non-finite sizes", () => {
    strictEqual(isValidOrderSize(baseState({ size: 0.001 })), true);
    strictEqual(isValidOrderSize(baseState({ size: 0.0009 })), false);
    strictEqual(isValidOrderSize(baseState({ size: NaN })), false);
});

test("isValidLimitOrder additionally requires a positive finite price", () => {
    strictEqual(isValidLimitOrder(baseState({ price: 100 })), true);
    strictEqual(isValidLimitOrder(baseState({ price: 0 })), false);
    strictEqual(isValidLimitOrder(baseState({ price: -1 })), false);
    strictEqual(isValidLimitOrder(baseState({ size: 0, price: 100 })), false);
});

test("isValidStopOrder requires the trigger price on the correct side of the current price", () => {
    const state = baseState({ currentPrice: 100, triggerPrice: 110 });
    strictEqual(isValidStopOrder(state, "BUY"), true);
    strictEqual(isValidStopOrder(state, "SELL"), false);
    strictEqual(isValidStopOrder(baseState({ currentPrice: 100, triggerPrice: 90 }), "SELL"), true);
    strictEqual(isValidStopOrder(baseState({ currentPrice: 0, triggerPrice: 110 }), "BUY"), false);
});

test("isValidIFDOCOOrder requires a valid width and ratio and positive exit prices", () => {
    const state = baseState({ currentPrice: 100000 });
    strictEqual(isValidIFDOCOOrder(state, "BUY"), true);
    strictEqual(isValidIFDOCOOrder(state, "SELL"), true);

    const invalidWidth = baseState({ currentPrice: 100000, ifdocoOrder: new IFDOCOrder(0, 50) });
    strictEqual(isValidIFDOCOOrder(invalidWidth, "BUY"), false);

    const invalidRatio = baseState({ currentPrice: 100000, ifdocoOrder: new IFDOCOrder(10000, NaN) });
    strictEqual(isValidIFDOCOOrder(invalidRatio, "BUY"), false);

    const lossAboveCurrent = baseState({ currentPrice: 100, ifdocoOrder: new IFDOCOrder(1000, 0) });
    strictEqual(isValidIFDOCOOrder(lossAboveCurrent, "BUY"), false);
});

test("canClearPosition requires an open position, no pending close, and a fresh credential version", () => {
    const position = new Position([{ price: 100, side: "BUY", size: 1 }]);
    const openPosition = baseState({ position, positionCredentialVersion: currentCredentialVersion()! });
    strictEqual(canClearPosition(openPosition), true);

    strictEqual(canClearPosition(baseState({ position, isOrdering: true, positionCredentialVersion: currentCredentialVersion()! })), false);
    strictEqual(canClearPosition(baseState({ position, positionClosePending: true, positionCredentialVersion: currentCredentialVersion()! })), false);
    strictEqual(canClearPosition(baseState({ position: new Position([]), positionCredentialVersion: currentCredentialVersion()! })), false);
    strictEqual(canClearPosition(baseState({ position, positionCredentialVersion: currentCredentialVersion()! + 1 })), false);
});
