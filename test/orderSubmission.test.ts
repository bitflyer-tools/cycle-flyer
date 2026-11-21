import {mockDOMSource, VNode} from "@cycle/dom";
import {RequestInput, RequestOptions, Response, ResponseStream} from "@cycle/http";
import {MainHTTPSource} from "@cycle/http/lib/cjs/MainHTTPSource";
import {StateSource} from "@cycle/state";
import {routerify} from "cyclic-router";
import {deepEqual, equal, match} from "node:assert/strict";
import {once} from "node:events";
import {createServer} from "node:http";
import {test, TestContext} from "node:test";
import {setImmediate as flush} from "node:timers/promises";
import switchPath from "switch-path";
import Stream, {MemoryStream} from "xstream";
import {Sound} from "../src/drivers/soundDriver";
import {Root, Sinks, Sources} from "../src/components";
import {State as TradeState} from "../src/components/trade";
import {stopSection} from "../src/components/trade/order/stopView";
import {storageKeys} from "../src/components/trade/order/intent";
import {Execution} from "../src/models/execution";
import {HISTORY_LIMIT} from "../src/models/orderHistory";
import type {State as SummaryState} from "../src/components/trade/summary";
import {view as summaryView} from "../src/components/trade/summary/view";
import {currentCredentialVersion, saveCredentials} from "../src/credentials";
import {AccountRequest, authorizeRequest, makeHTTPDriver, makeSignedHTTPDriver, unsignedRequests$} from "../src/drivers/httpDriver";
import {cancelOrders, getParentOrders, limitOrder, parentOrdersPageSize, stopOrder, twapSliceOrder} from "../src/http";
import {flattenStopOrders} from "../src/models/parentStopOrders";

test("shows a signing error for a market order without credentials and clears it on retry", async (t) => {
    const order = setup(t);
    await saveCredentials(null);
    order.buy("market");
    equal(order.state.isOrdering, true);

    await rejectUnsigned(order.requests[0]);
    equal(order.state.isOrdering, false);
    equal(order.signingAlert?.text, "Could not sign the order. Check your bitFlyer credentials in Settings.");

    order.buy("market");
    equal(order.requests.length, 2);
    equal(order.signingAlert, undefined);
});

test("shows a clear-orders signing error after returning from Settings", async (t) => {
    const order = setup(t);
    await saveCredentials({ key: "test-key", secret: "test-secret" });
    t.after(() => saveCredentials(null));
    order.respondTo({ url: "https://api.bitflyer.jp/v1/me/getorders", category: "orders", _namespace: ["trade"] })
        .succeed([{ side: "BUY", size: 0.1, price: 100 }]);
    order.clearOrders();
    equal(order.requests[0].category, "cancel-orders");
    equal(order.state.isOrdering, true);
    order.navigate("/setting");

    await rejectUnsigned({ ...order.requests[0], send: {} });
    order.navigate("/");
    equal(order.state.isOrdering, false);
    equal(order.signingAlert?.text,
        "Could not sign the request to clear orders. Check your bitFlyer credentials in Settings.");
});

test("blocks both IFDOCO sides until the first public execution arrives", (t) => {
    const order = setup(t, "10000", { initialPrice: null });
    order.buy("ifdoco");
    order.sellIFDOCO();
    deepEqual(order.requests, []);
    equal(order.state.isOrdering, false);

    order.publishExecution(10000000);
    order.buy("ifdoco");
    equal(order.requests[0]?.category, "ifdoco-order");
    order.respondTo(order.requests[0]).succeed();
    order.sellIFDOCO();
    deepEqual(order.requests.map(({ category }) => category), ["ifdoco-order", "ifdoco-order"]);
});

test("blocks both stop sides for invalid triggers or a missing market price", (t) => {
    const order = setup(t, "0.01", { initialPrice: null });
    const assertBothBlocked = () => {
        const section = stopSection(order.state);
        const [, buttons] = section.children as VNode[];
        const [, sell, buy] = buttons.children as VNode[];
        equal(sell.data?.attrs?.disabled, true);
        equal(buy.data?.attrs?.disabled, true);
        order.buy("stop");
        order.sellStop();
        deepEqual(order.requests, []);
    };

    assertBothBlocked();
    order.publishExecution(100000);
    for (const value of ["Infinity", "-Infinity", "invalid", "0", "-1", "100000"]) {
        order.enterTriggerPrice(value);
        assertBothBlocked();
    }
});

test("submits only the stop side matching the trigger direction and preserves the trigger price", (t) => {
    const order = setup(t, "0.01", { initialPrice: 100000 });
    order.enterTriggerPrice("110000.25");
    order.sellStop();
    deepEqual(order.requests, []);
    order.buy("stop");
    order.respondTo(order.requests[0]).succeed();

    order.enterTriggerPrice("90000.75");
    order.buy("stop");
    equal(order.requests.length, 1);
    order.sellStop();

    deepEqual(order.requests.map(({ category, send }) => {
        const [{ side, trigger_price }] = JSON.parse(send as string).parameters;
        return { category, side, trigger_price };
    }), [
        { category: "stop-order", side: "BUY", trigger_price: 110000.25 },
        { category: "stop-order", side: "SELL", trigger_price: 90000.75 },
    ]);
});

test("rejects invalid IFDOCO clicks without blocking the next market order", (t) => {
    const order = setup(t, "-10000");

    order.buy("ifdoco");
    order.sellIFDOCO();
    deepEqual(order.requests, []);
    equal(order.state.isOrdering, false);

    order.buy("market");
    deepEqual(order.requests.map(({ category }) => category), ["market-order"]);
    equal(order.state.isOrdering, true);
});

test("accepts a single IFDOCO submission until its delayed success", (t) => {
    const order = setup(t);

    order.buy("ifdoco");
    order.buy("ifdoco");
    order.sellIFDOCO();
    order.buy("market");

    deepEqual(order.requests.map(({ category }) => category), ["ifdoco-order"]);
    equal(order.state.isOrdering, true);
    deepEqual(order.sounds, []);

    const response = order.respondTo(order.requests[0]);
    response.progress();
    deepEqual(order.sounds, []);
    deepEqual(order.histories, []);
    response.succeed();
    equal(order.state.isOrdering, false);
    deepEqual(order.sounds, ["success"]);
    deepEqual(order.histories.map(({ status }) => status), ["success", "success", "success"]);

    order.sellIFDOCO();
    equal(order.requests.length, 2);
    equal(JSON.parse(order.requests[1].send as string).parameters[0].side, "SELL");
    const sellResponse = order.respondTo(order.requests[1]);
    order.respondTo(order.requests[0]).succeed();
    equal(order.state.isOrdering, true);

    sellResponse.succeed();
    equal(order.state.isOrdering, false);
    equal(order.histories.length, 9);
});

test("bounds the history when an IFDOCO result arrives in settings", (t) => {
    const order = setup(t);
    Array.from({ length: HISTORY_LIMIT }, (_, index) => {
        order.buy("market");
        order.respondTo(order.requests[index]).succeed();
    });
    const previous = order.histories;

    order.buy("ifdoco");
    order.navigate("/setting");
    order.respondTo(order.requests[HISTORY_LIMIT]).succeed();
    order.navigate("/");

    deepEqual(order.histories.slice(0, 3).map(({ name }) => name), ["Stop", "Limit", "Market"]);
    deepEqual(order.histories.slice(3), previous.slice(0, HISTORY_LIMIT - 3));
});

test("releases a failed IFDOCO and keeps a later market order locked through stale responses", (t) => {
    const order = setup(t);

    order.buy("ifdoco");
    order.respondTo(order.requests[0]).fail();
    equal(order.state.isOrdering, false);
    deepEqual(order.histories.map(({ status }) => status), ["failed", "failed", "failed"]);

    order.buy("market");
    const marketResponse = order.respondTo(order.requests[1]);
    const staleResponse = order.respondTo(order.requests[0]);
    staleResponse.succeed();
    equal(order.histories.length, 6);
    equal(order.state.isOrdering, true);
    order.buy("ifdoco");
    equal(order.requests.length, 2);

    marketResponse.succeed();
    equal(order.state.isOrdering, false);
    equal(order.histories[0].name, "Market");
    order.buy("ifdoco");
    equal(order.requests.length, 3);
});

for (const outcome of ["succeed", "fail"] as const) {
    const status = outcome === "succeed" ? "success" : "failed";
    const sound = outcome === "succeed" ? "success" : "failure";
    const expectedHistories = ["Stop", "Limit", "Market"].map((name) => ({ name, status }));

    test(`keeps IFDOCO pending after returning from settings until the original request settles (${outcome})`, (t) => {
        const order = setup(t);
        order.buy("ifdoco");
        const response = order.respondTo(order.requests[0]);

        order.navigate("/setting");
        order.navigate("/");
        equal(order.state.isOrdering, true);
        order.sellIFDOCO();
        equal(order.requests.length, 1);

        deepEqual(order.sounds, []);
        response[outcome]();
        deepEqual(order.sounds, [sound]);
        equal(order.state.isOrdering, false);
        deepEqual(order.histories.map(({ name, status }) => ({ name, status })), expectedHistories);
        order.sellIFDOCO();
        equal(order.requests.length, 2);
    });

    for (const [category, names] of [
        ["market", ["Market"]],
        ["limit", ["Limit"]],
        ["stop", ["Stop"]],
        ["ifdoco", ["Stop", "Limit", "Market"]],
    ] as const) {
        test(`records a pending ${category} order that settles in settings (${outcome})`, async (t) => {
            const order = setup(t);
            order.buy(category);
            deepEqual(order.requests.map(({ category }) => category), [`${category}-order`]);
            const response = order.respondTo(order.requests[0]);

            order.navigate("/setting");
            await flush();
            response.progress();
            deepEqual(order.sounds, []);
            deepEqual(order.histories, []);

            response[outcome]();
            deepEqual(order.sounds, [sound]);
            const histories = names.map((name) => ({ name, status }));
            deepEqual(order.histories.map(({ name, status }) => ({ name, status })), histories);

            order.navigate("/");
            await flush();
            deepEqual(order.sounds, [sound]);
            equal(order.state.isOrdering, false);
            deepEqual(order.histories.map(({ name, status }) => ({ name, status })), histories);
            order.buy(category);
            equal(order.requests.length, 2);
        });
    }
}

test("records a rejected limit order and permits a retry", (t) => {
    const order = setup(t, "0.01", { apis: ["Date", "setInterval"] });
    order.enterPrice("900");

    order.buy("limit");
    deepEqual(order.requests.map(({ category }) => category), ["limit-order"]);
    equal(order.state.isOrdering, true);

    order.respondTo(order.requests[0]).reject();
    equal(order.state.isOrdering, false);
    deepEqual(order.sounds, ["failure"]);
    deepEqual(order.histories, [{
        createdAt: new Date(1000),
        description: "BUY / 0.03 / 900",
        name: "Limit",
        status: "failed",
    }]);

    order.buy("limit");
    deepEqual(order.requests.map(({ category }) => category), ["limit-order", "limit-order"]);
    equal(order.state.isOrdering, true);
});

test("reports mixed Clear Orders results and stays locked until every request settles", async (t) => {
    const order = setup(t);
    await saveCredentials({ key: "test-key", secret: "test-secret" });
    t.after(() => saveCredentials(null));
    order.respondTo({ url: "https://api.bitflyer.jp/v1/me/getorders", category: "orders", _namespace: ["trade"] }).succeed([
        { price: 100, side: "BUY", outstanding_size: 0.01 },
    ]);
    order.respondTo({ url: "https://api.bitflyer.jp/v1/me/getparentorders", category: "parent-orders", _namespace: ["trade"] }).succeed([
        { parent_order_id: "JCO-success" },
        { parent_order_id: "JCO-failure" },
    ]);
    order.parentDetails.forEach((request, id) => order.respondTo(request).succeed({
        parent_order_id: id,
        parameters: [{ condition_type: "STOP", trigger_price: id === "JCO-success" ? 200 : 300 }],
    }));

    order.clearOrders();
    order.clearOrders();
    deepEqual(order.requests.map(({ category }) => category), [
        "cancel-orders", "cancel-parent-order", "cancel-parent-order",
    ]);
    equal(order.state.isOrdering, true);
    equal(order.tradeState.orders.length, 1);
    deepEqual(flattenStopOrders(order.tradeState.parentStopOrders).map(({ price }) => price), [200, 300]);

    order.respondTo(order.requests[2]).fail();
    equal(order.state.isOrdering, true);
    deepEqual(Object.keys(order.tradeState.parentStopOrders), ["JCO-success", "JCO-failure"]);
    order.respondTo(order.requests[1]).succeed();
    order.buy("market");
    equal(order.requests.length, 3);
    equal(order.state.isOrdering, true);
    deepEqual(Object.keys(order.tradeState.parentStopOrders), ["JCO-failure"]);

    order.respondTo(order.requests[0]).succeed();
    equal(order.state.isOrdering, false);
    deepEqual(order.tradeState.orders, []);
    deepEqual(flattenStopOrders(order.tradeState.parentStopOrders).map(({ price }) => price), [300]);
    deepEqual(order.histories.map(({ name, description, status }) => [name, description, status]), [
        ["Cancel", "All child orders", "success"],
        ["Cancel", "Parent order JCO-success", "success"],
        ["Cancel", "Parent order JCO-failure", "failed"],
    ]);
    deepEqual(order.sounds, ["failure", "success", "success"]);
    order.clearOrders();
    deepEqual(order.requests.slice(3).map(({ category }) => category), ["cancel-orders", "cancel-parent-order"]);
    equal(JSON.parse(order.requests[4].send as string).parent_order_id, "JCO-failure");
});

test("reports a failed bulk cancellation and keeps the child orders visible", (t) => {
    const order = setup(t);
    order.respondTo({ url: "https://api.bitflyer.jp/v1/me/getorders", category: "orders", _namespace: ["trade"] }).succeed([
        { price: 100, side: "BUY", outstanding_size: 0.01 },
    ]);
    const childOrders = order.tradeState.orders;

    order.clearOrders();
    order.respondTo(order.requests[0]).fail();

    equal(order.state.isOrdering, false);
    equal(order.tradeState.orders, childOrders);
    deepEqual(order.histories.map(({ description, status }) => [description, status]), [
        ["All child orders", "failed"],
    ]);
    deepEqual(order.sounds, ["failure"]);
});

test("keeps a parent order visible when its cancellation times out", async (t) => {
    const order = setup(t);
    await saveCredentials({ key: "test-key", secret: "test-secret" });
    t.after(() => saveCredentials(null));
    order.respondTo({ url: "https://api.bitflyer.jp/v1/me/getparentorders", category: "parent-orders", _namespace: ["trade"] })
        .succeed([{ parent_order_id: "JCO-timeout" }]);
    order.respondTo(order.parentDetails.get("JCO-timeout")!).succeed({
        parent_order_id: "JCO-timeout",
        parameters: [{ condition_type: "STOP", trigger_price: 200 }],
    });
    deepEqual(flattenStopOrders(order.tradeState.parentStopOrders).map(({ price }) => price), [200]);

    order.clearOrders();
    order.respondTo(order.requests[0]).succeed();
    order.respondTo(order.requests[1]).fail(
        Object.assign(new Error("Deadline exceeded"), { code: "ECONNABORTED", errno: "ETIME" }),
    );

    equal(order.state.isOrdering, false);
    deepEqual(Object.keys(order.tradeState.parentStopOrders), ["JCO-timeout"]);
    deepEqual(order.histories.map(({ description, status }) => [description, status]), [
        ["Parent order JCO-timeout", "unconfirmed"],
        ["All child orders", "success"],
    ]);
});

test("ignores Clear Orders results from the previous account", async (t) => {
    const order = setup(t);
    await saveCredentials({ key: "account-a", secret: "secret-a" });
    t.after(() => saveCredentials(null));
    const parentOrders = order.polls.find(({ category }) => category === "parent-orders")!;
    order.respondTo(parentOrders).succeed([{ parent_order_id: "JCO-old" }]);
    order.clearOrders();
    deepEqual(order.requests.map(({ category }) => category), ["cancel-orders", "cancel-parent-order"]);
    const [bulkCancel, parentCancel] = order.requests;
    const pendingBulkCancel = order.respondTo(bulkCancel);
    const pendingParentCancel = order.respondTo(parentCancel);

    order.navigate("/setting");
    await saveCredentials({ key: "account-b", secret: "secret-b" });
    order.navigate("/");
    pendingParentCancel.fail();
    pendingBulkCancel.succeed();

    equal(order.state.isOrdering, false);
    deepEqual(order.histories, []);
    deepEqual(order.sounds, []);
});

test("clears collateral and child orders and ignores late responses after switching credentials", async (t) => {
    const trade = setup(t);
    await saveCredentials({ key: "account-a", secret: "secret-a" });
    t.after(() => saveCredentials(null));
    const orders = trade.polls.find(({ category }) => category === "orders")!;
    const collateral = trade.polls.find(({ category }) => category === "collateral")!;
    const oldVersion = currentCredentialVersion()!;
    const oldOrders = [{ side: "BUY", size: 0.1, price: 100 }];
    trade.respondTo(orders).succeed(oldOrders);
    trade.respondTo(collateral).succeed({ collateral: 1000 });
    equal(trade.tradeState.orders.length, 1);
    equal(trade.tradeState.summaryComponentState!.collateral, 1000);

    await saveCredentials({ key: "account-b", secret: "secret-b" });
    deepEqual(trade.tradeState.orders, []);
    equal(trade.tradeState.summaryComponentState!.collateral, 0);

    const current = trade.respondTo(orders);
    trade.respondTo({ ...orders, credentialVersion: oldVersion }).succeed(oldOrders);
    trade.respondTo({ ...collateral, credentialVersion: oldVersion }).succeed({ collateral: 1000 });
    deepEqual(trade.tradeState.orders, []);
    equal(trade.tradeState.summaryComponentState!.collateral, 0);
    current.succeed([{ side: "SELL", size: 0.2, price: 200 }]);
    deepEqual(trade.tradeState.orders.map(({ price }) => price), [200]);
});

test("settles an unsigned parent cancellation while waiting for the rest of Clear Orders", async (t) => {
    const order = setup(t);
    await saveCredentials(null);
    order.respondTo({ url: "https://api.bitflyer.jp/v1/me/getparentorders", category: "parent-orders", _namespace: ["trade"] }).succeed([
        { parent_order_id: "JCO-unsigned" },
    ]);

    order.clearOrders();
    deepEqual(order.requests.map(({ category }) => category), ["cancel-orders", "cancel-parent-order"]);
    await rejectUnsigned(order.requests[1]);
    equal(order.state.isOrdering, true);
    equal(order.signingAlert?.text, "Could not sign the request to clear orders. Check your bitFlyer credentials in Settings.");

    order.respondTo(order.requests[0]).succeed();
    equal(order.state.isOrdering, false);
    deepEqual(Object.keys(order.tradeState.parentStopOrders), ["JCO-unsigned"]);
    order.clearOrders();
    equal(order.requests.length, 4);
    equal(order.signingAlert, undefined);
});

test("blocks TWAP with missing credentials and immediately after clearing them", async (t) => {
    const order = setup(t);
    await saveCredentials(null);
    order.buyTWAP();
    equal(order.requests.length, 0);
    equal(order.state.twap.remaining, 0);

    await saveCredentials({ key: "test-key", secret: "test-secret" });
    order.buyTWAP();
    equal(order.requests.length, 1);

    const clearing = saveCredentials(null);
    order.buyTWAP();
    await clearing;
    order.buyTWAP();
    equal(order.requests.length, 1);
    equal(order.state.twap.remaining, 0);
    equal(order.state.twap.error, "TWAP stopped because credentials changed.");
});

test("stops TWAP on signing failure and ignores old slices after a restart", async (t) => {
    const order = setup(t);
    await saveCredentials({ key: "test-key", secret: "test-secret" });
    t.after(() => saveCredentials(null));

    order.buyTWAP();
    const signed = await authorizeRequest(order.requests[0]) as RequestOptions;
    const previousResponse = order.respondTo(signed);
    t.mock.timers.tick(1000);

    equal(await authorizeRequest({ ...order.requests[1], send: {} }), null);
    equal(order.state.twap.remaining, 0);
    equal(order.state.twap.error, "TWAP stopped because an order could not be signed.");
    t.mock.timers.tick(3000);
    equal(order.requests.length, 2);

    order.buyTWAP();
    equal(order.state.twap.remaining, 3);
    equal(order.state.twap.error, undefined);
    previousResponse.succeed();
    equal(order.state.twap.remaining, 3);
    equal(order.histories[0].name, "TWAP");
});

test("clears the previous account position and only closes a position from the current account", async (t) => {
    const order = setup(t);
    await saveCredentials({ key: "first-key", secret: "first-secret" });
    t.after(() => saveCredentials(null));

    const positions = { url: "https://api.bitflyer.jp/v1/me/getpositions", category: "positions", _namespace: ["trade"] };
    const oldVersion = currentCredentialVersion()!;
    const oldPosition = [{ side: "BUY", size: 0.3, price: 100 }];
    order.respondTo(positions).succeed(oldPosition);
    equal(order.clearPositionDisabled, false);
    order.clearPosition();
    const queuedClose = order.requests[0];
    const previousClose = order.respondTo(queuedClose);
    equal(order.tradeState.positionClose?.settled, false);

    order.navigate("/setting");
    const saving = saveCredentials({ key: "second-key", secret: "second-secret" });
    equal(order.tradeState.position.size, 0);
    equal(Boolean(order.tradeState.positionClose), false);
    order.navigate("/");
    equal(order.clearPositionDisabled, true);
    order.clearPosition();
    await saving;

    order.respondTo({ ...positions, credentialVersion: oldVersion }).succeed(oldPosition);
    equal(order.tradeState.position.size, 0);
    equal(order.clearPositionDisabled, true);
    order.clearPosition();
    equal(order.requests.length, 1);
    equal(await authorizeRequest(queuedClose), null);

    order.respondTo(positions).succeed([]);
    equal(order.clearPositionDisabled, true);
    order.respondTo(positions).succeed([{ side: "SELL", size: 0.1, price: 200 }]);
    equal(order.clearPositionDisabled, false);
    order.clearPosition();
    equal(order.requests.length, 2);
    const close = JSON.parse(order.requests[1].send as string);
    deepEqual({ side: close.side, size: close.size }, { side: "BUY", size: 0.1 });
    const signed = await authorizeRequest(order.requests[1]) as RequestOptions;
    equal((signed.headers as Record<string, string>)["ACCESS-KEY"], "second-key");
    previousClose.succeed();
    equal(order.state.isOrdering, true);
    equal(order.tradeState.positionClose?.settled, false);
    order.clearPosition();
    equal(order.requests.length, 2);
});

test("continues pagination when a previous account's parent-order list arrives", async (t) => {
    const trade = setup(t);
    await saveCredentials({ key: "account-a", secret: "secret-a" });
    t.after(() => saveCredentials(null));

    const list = { ...getParentOrders(), _namespace: ["trade"] };
    const previous = await authorizeRequest(list) as AccountRequest;
    await saveCredentials({ key: "account-b", secret: "secret-b" });
    const current = trade.respondTo(await authorizeRequest(list) as AccountRequest);
    const fullPage = Array.from({ length: parentOrdersPageSize }, (_, index) =>
        ({ id: index + 2, parent_order_id: `parent-${index + 2}` }));

    trade.respondTo(previous).succeed(fullPage);
    equal(trade.pages.length, 0);

    current.succeed(fullPage);
    equal(trade.pages.length, 1);
    const page = await authorizeRequest(trade.pages[0]) as AccountRequest;
    equal((page.headers as Record<string, string>)["ACCESS-KEY"], "account-b");
    trade.respondTo(page).succeed([]);
});

test("a pending IFDOCO from the previous account cannot lock or update the new account", async (t) => {
    const trade = setup(t);
    await saveCredentials({ key: "account-a", secret: "secret-a" });
    t.after(() => saveCredentials(null));
    trade.buy("ifdoco");
    equal(trade.state.isOrdering, true);
    const original = trade.respondTo(trade.requests[0]);

    trade.navigate("/setting");
    await saveCredentials({ key: "account-b", secret: "secret-b" });
    trade.navigate("/");
    equal(trade.state.isOrdering, false);
    trade.buy("market");
    equal(trade.state.isOrdering, true);

    original.fail();
    equal(trade.state.isOrdering, true);
    equal(trade.histories.length, 0);
    equal(trade.sounds.length, 0);
});

function rejectUnsigned(request: RequestOptions) {
    return new Promise<void>((resolve, reject) => {
        unsignedRequests$.filter((unsigned) => unsigned === request).take(1).addListener({ next: () => resolve() });
        makeSignedHTTPDriver()(Stream.of(request)).select().addListener({
            next: () => reject(new Error("An unsigned request reached the HTTP driver")),
        });
    });
}

function findNode(node: VNode, selector: string): VNode | undefined {
    if (node.sel === selector) { return node; }
    return node.children?.map((child) => typeof child === "string" ? undefined : findNode(child, selector)).find(Boolean);
}

test("keeps Clear Position disabled until a full fill is confirmed", async (t) => {
    const order = setup(t);
    await saveCredentials({ key: "test-key", secret: "test-secret" });
    t.after(() => saveCredentials(null));
    const position = [{ side: "BUY", size: 0.08, price: 40000 }];
    order.respondTo(order.positionRequests[0]).succeed(position);
    equal(order.tradeState.position.size, 0.08);

    order.clearPosition();
    order.clearPosition();
    equal(order.requests.length, 1);
    const { side, size, child_order_type } = JSON.parse(order.requests[0].send as string);
    deepEqual({ side, size, child_order_type }, { side: "SELL", size: 0.08, child_order_type: "MARKET" });

    order.respondTo(order.requests[0]).succeed({ child_order_acceptance_id: "JRF-accepted" });
    equal(order.state.isOrdering, false);
    equal(order.tradeState.positionClose?.rejected, false);
    deepEqual(order.histories.map(({ status }) => status), ["success"]);
    deepEqual(order.sounds, ["success"]);
    order.clearPosition();
    equal(order.requests.length, 1);

    equal(order.positionRequests.length, 2);
    order.respondTo(order.positionRequests[1]).succeed([]);
    equal(order.tradeState.position.size, 0);
    equal(order.tradeState.positionClose, undefined);
    order.clearPosition();
    equal(order.requests.length, 1);
});

test("uses only the confirmed short remainder after a partial close", async (t) => {
    const order = setup(t);
    await saveCredentials({ key: "test-key", secret: "test-secret" });
    t.after(() => saveCredentials(null));
    const position = { side: "SELL", size: 0.08, price: 40000 };
    const initialPoll = order.positionRequests[0];
    order.respondTo(initialPoll).succeed([position]);
    order.clearPosition();
    order.respondTo(order.requests[0]).succeed();

    const refresh = order.positionRequests.at(-1)!;
    order.respondTo(initialPoll).succeed([{ ...position, size: 0.04 }]);
    equal(!!order.tradeState.positionClose, true);
    order.respondTo(refresh).succeed([position]);
    equal(!!order.tradeState.positionClose, true);
    order.clearPosition();
    equal(order.requests.length, 1);

    t.mock.timers.tick(10000);
    order.respondTo(order.positionRequests.at(-1)!).succeed([{ ...position, size: 0.03 }]);
    equal(order.tradeState.positionClose, undefined);
    order.clearPosition();
    equal(order.requests.length, 2);
    const { side, size } = JSON.parse(order.requests[1].send as string);
    deepEqual({ side, size }, { side: "BUY", size: 0.03 });
});

test("records an HTTP 200 close rejection as a failed order and plays the failure sound", async (t) => {
    const order = setup(t);
    await saveCredentials({ key: "test-key", secret: "test-secret" });
    t.after(() => saveCredentials(null));
    order.respondTo(order.positionRequests[0]).succeed([{ side: "BUY", size: 0.08, price: 40000 }]);
    order.clearPosition();

    order.respondTo(order.requests[0]).succeed({ status: -1, error_message: "Order rejected" });

    equal(order.tradeState.positionClose?.settled, true);
    equal(order.tradeState.positionClose?.rejected, true);
    deepEqual(order.histories.map(({ status }) => status), ["failed"]);
    deepEqual(order.sounds, ["failure"]);
});

test("unlocks an unsigned Clear Position after refreshing the current position", async (t) => {
    const order = setup(t);
    await saveCredentials({ key: "test-key", secret: "test-secret" });
    t.after(() => saveCredentials(null));
    const position = [{ side: "BUY", size: 0.08, price: 40000 }];
    order.respondTo(order.positionRequests[0]).succeed(position);
    order.clearPosition();

    await rejectUnsigned({ ...order.requests[0], send: {} });
    equal(order.state.isOrdering, false);
    equal(order.clearPositionDisabled, true);
    equal(order.positionRequests.length, 2);

    order.respondTo(order.positionRequests[1]).succeed(position);
    equal(order.clearPositionDisabled, false);
    order.clearPosition();
    equal(order.requests.length, 2);
});

test("allows retry after a definite rejection and a fresh unchanged position", async (t) => {
    const order = setup(t);
    await saveCredentials({ key: "test-key", secret: "test-secret" });
    t.after(() => saveCredentials(null));
    const position = [{ side: "BUY", size: 0.08, price: 40000 }];
    const initialPoll = order.positionRequests[0];
    order.respondTo(initialPoll).succeed(position);
    order.clearPosition();

    order.respondTo(order.requests[0]).reject(400);
    equal(order.state.isOrdering, false);
    equal(order.positionRequests.length, 2);
    order.respondTo(initialPoll).succeed(position);
    order.clearPosition();
    equal(order.requests.length, 1);

    order.respondTo(order.positionRequests[1]).succeed({ error_message: "Position unavailable" });
    order.clearPosition();
    equal(order.requests.length, 1);

    t.mock.timers.tick(10000);
    order.respondTo(order.positionRequests.at(-1)!).succeed(position);
    equal(order.tradeState.positionClose, undefined);
    order.clearPosition();
    equal(order.requests.length, 2);
    const { side, size } = JSON.parse(order.requests[1].send as string);
    deepEqual({ side, size }, { side: "SELL", size: 0.08 });
});

for (const failure of ["network", "server"] as const) {
    test(`waits for position reconciliation after an ambiguous ${failure} failure`, async (t) => {
        const order = setup(t);
        await saveCredentials({ key: "test-key", secret: "test-secret" });
        t.after(() => saveCredentials(null));
        const position = [{ side: "BUY", size: 0.08, price: 40000 }];
        order.respondTo(order.positionRequests[0]).succeed(position);
        order.clearPosition();

        order.navigate("/setting");
        const response = order.respondTo(order.requests[0]);
        if (failure === "network") response.fail();
        else response.reject(503);
        order.navigate("/");
        order.clearPosition();
        equal(order.requests.length, 1);

        order.respondTo(order.positionRequests.at(-1)!).succeed(position);
        equal(!!order.tradeState.positionClose, true);
        order.clearPosition();
        equal(order.requests.length, 1);

        t.mock.timers.tick(10000);
        order.respondTo(order.positionRequests.at(-1)!).succeed([]);
        equal(order.tradeState.positionClose, undefined);
        order.clearPosition();
        equal(order.requests.length, 1);
    });
}

for (const category of ["limit-order", "cancel-orders", "market-order"] as const) {
    test(`aborts a stalled ${category} and displays it as unconfirmed without retrying`, { timeout: 5_000 }, async (t) => {
        const paths: string[] = [];
        const server = createServer((request, response) => {
            request.resume();
            paths.push(new URL(request.url!, "http://localhost").pathname);
            if (paths.length === 1) {
                return;
            }
            response.end();
        });
        t.after(() => {
            server.closeAllConnections();
            server.close();
        });
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const address = server.address() as { port: number };
        const order = setup(t, "0.01", { writeOrigin: `http://127.0.0.1:${address.port}`, apis: [] });
        order.enterPrice("10000");
        const position = [{ side: "BUY", size: 0.08, price: 40000 }];
        if (category === "market-order") {
            await saveCredentials({ key: "test-key", secret: "test-secret" });
            t.after(() => saveCredentials(null));
            order.respondTo(order.positionRequests[0]).succeed(position);
        }
        if (category === "cancel-orders") {
            order.respondTo({ url: "https://api.bitflyer.jp/v1/me/getorders", category: "orders", _namespace: ["trade"] })
                .succeed([{ side: "BUY", size: 0.1, price: 100 }]);
        }
        const submit = {
            "limit-order": () => order.buy("limit"),
            "cancel-orders": order.clearOrders,
            "market-order": order.clearPosition,
        }[category];
        const path = category === "cancel-orders" ? "/v1/me/cancelallchildorders" : "/v1/me/sendchildorder";

        const receivedFirst = once(server, "request");
        submit();
        submit();
        equal(order.state.isOrdering, true);
        order.navigate("/setting");
        const [, stalledResponse] = await receivedFirst;
        await once(stalledResponse, "close");
        order.navigate("/");
        equal(order.state.isOrdering, false);
        deepEqual(paths, [path]);
        equal(order.requests.length, 1);
        deepEqual(order.histories.map(({ status }) => status), ["unconfirmed"]);
        deepEqual(order.sounds, ["failure"]);
        summaryView(Stream.of<SummaryState>({
            ...order.tradeState,
            priceAlert: order.tradeState.summaryComponentState!.priceAlert,
            collateral: 0,
            marketState: { health: "", state: "" },
        })).addListener({ next: (vnode) => match(JSON.stringify(vnode), /Unconfirmed \(timed out\)/) });

        if (category === "market-order") {
            order.respondTo(order.positionRequests.at(-1)!).succeed(position);
            submit();
            equal(order.requests.length, 1);
            equal(order.tradeState.positionClose?.settled, true);
            equal(order.tradeState.positionClose?.rejected, false);
            return;
        }

        const received = once(server, "request");
        submit();
        await received;
        deepEqual(paths, [path, path]);
        equal(order.requests.length, 2);
    });
}

for (const route of ["/", "/setting"]) {
    test(`records a TWAP slice deadline once when it expires on ${route}`, (t) => {
        const order = setup(t);
        Array.from({ length: HISTORY_LIMIT }, (_, index) => {
            order.buy("market");
            order.respondTo(order.requests[index]).succeed();
        });
        const previous = order.histories;
        const request = twapSliceOrder(0.01, "BUY", Symbol());
        const response = order.respondTo({ ...request, _namespace: ["trade"] });

        if (route === "/setting") order.navigate(route);
        response.fail(Object.assign(new Error("Deadline exceeded"), { code: "ECONNABORTED", errno: "ETIME" }));
        const { name, status } = order.histories[0];
        deepEqual({ name, status }, { name: "TWAP", status: "unconfirmed" });
        deepEqual(order.histories.slice(1), previous.slice(0, HISTORY_LIMIT - 1));

        if (route === "/setting") order.navigate("/");
        equal(order.histories.length, HISTORY_LIMIT);
        summaryView(Stream.of<SummaryState>({
            ...order.tradeState,
            priceAlert: order.tradeState.summaryComponentState!.priceAlert,
            collateral: 0,
            marketState: { health: "", state: "" },
        })).addListener({ next: (vnode) => match(JSON.stringify(vnode), /Unconfirmed \(timed out\)/) });
    });
}

test("ignores order and cancellation deadlines from the previous account", async (t) => {
    const order = setup(t);
    await saveCredentials({ key: "first-key", secret: "first-secret" });
    t.after(() => saveCredentials(null));
    order.buy("market");
    const market = order.respondTo(order.requests[0]);
    const cancel = order.respondTo({
        url: "https://api.bitflyer.jp/v1/me/cancelallchildorders",
        category: "cancel-orders",
        send: "{}",
    });

    order.navigate("/setting");
    await saveCredentials({ key: "second-key", secret: "second-secret" });
    const deadline = Object.assign(new Error("Deadline exceeded"), { code: "ECONNABORTED", errno: "ETIME" });
    market.fail(deadline);
    cancel.fail(deadline);

    order.navigate("/");
    deepEqual(order.histories, []);
});

test("ignores write deadlines from the previous account", async (t) => {
    const trade = setup(t);
    const pending = [
        cancelOrders(),
        limitOrder(10000, 0.01, "BUY"),
        stopOrder(110000, 0.01, "BUY"),
        twapSliceOrder(0.01, "BUY", Symbol()),
    ]
        .map((request) => trade.respondTo({ ...request, _namespace: ["trade"] }));

    trade.navigate("/setting");
    await saveCredentials({ key: "account-b", secret: "secret-b" });
    t.after(() => saveCredentials(null));
    const timeout = Object.assign(new Error("Deadline exceeded"), { code: "ECONNABORTED", errno: "ETIME" });
    pending.forEach((response) => response.fail(timeout));
    trade.navigate("/");

    deepEqual(trade.histories, []);
    deepEqual(trade.sounds, []);
});

function setup(t: TestContext, width = "0.01", options: {
    initialPrice?: number | null;
    writeOrigin?: string;
    apis?: Array<"Date" | "setInterval">;
} = {}) {
    const { initialPrice = 10000000, writeOrigin, apis = ["setInterval"] } = options;
    if (apis.length > 0) t.mock.timers.enable({ apis, now: 1000 });
    const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { "api-key": "test", "api-secret": "test" } });
    t.after(() => {
        if (originalStorage) {
            Object.defineProperty(globalThis, "localStorage", originalStorage);
        } else {
            Reflect.deleteProperty(globalThis, "localStorage");
        }
    });

    const buy$ = {
        ifdoco: Stream.create<null>(),
        limit: Stream.create<null>(),
        market: Stream.create<null>(),
        stop: Stream.create<null>(),
    };
    const priceInput$ = Stream.createWithMemory<{ target: { value: string } }>();
    priceInput$.shamefullySendNext({ target: { value: "100000" } });
    const triggerInput$ = Stream.createWithMemory<{ target: { value: string } }>();
    triggerInput$.shamefullySendNext({ target: { value: "11000000" } });
    const sellStop$ = Stream.create<null>();
    const sellIFDOCO$ = Stream.create<null>();
    const buyTWAP$ = Stream.create<null>();
    const clearPosition$ = Stream.create<null>();
    const clearOrders$ = Stream.create<null>();
    const executionBatch$ = Stream.create<Execution[]>();
    const publishExecution = (price: number) => executionBatch$.shamefullySendNext([{ side: "BUY", price }]);
    const responses$ = Stream.create<MemoryStream<Response> & ResponseStream>();
    const writes$ = Stream.create<RequestInput | null>();
    const transport$ = makeHTTPDriver(250)(writes$).select();
    const source = new MainHTTPSource(Stream.merge(responses$, transport$), "HTTP");
    const state$ = Stream.createWithMemory<{ trade?: TradeState }>();
    const history$ = Stream.createWithMemory<{ pathname: string }>();
    history$.shamefullySendNext({ pathname: "/" });
    const orderEvents = {
        "#price-input": { input: priceInput$ },
        "#trigger-price-input": { input: triggerInput$ },
        ".order-buttons": { ".clear-order-button": { click: clearOrders$ }, ".clear-button": { click: clearPosition$ } },
        ".twap-order-buttons": { ".buy-button": { click: buyTWAP$ } },
        ".limit-order-buttons": { ".buy-button": { click: buy$.limit } },
        ".market-order-buttons": { ".buy-button": { click: buy$.market } },
        ".stop-order-buttons": { ".buy-button": { click: buy$.stop }, ".sell-button": { click: sellStop$ } },
        ".ranged-ifdoco-order-buttons": {
            ".buy-button": { click: buy$.ifdoco },
            ".sell-button": { click: sellIFDOCO$ },
        },
    };
    const main: Sinks = routerify(Root, switchPath)({
        DOM: mockDOMSource({ ".___trade": new Proxy({}, { get: (_, selector) =>
            typeof selector === "string" && selector.startsWith(".___cycle") ? orderEvents : undefined,
        }) }),
        HTTP: source,
        history: history$,
        socket: {
            board$: Stream.never(),
            childOrderEvent$: Stream.never(),
            execution$: Stream.never(),
            executionBatch$,
            parentOrderEvent$: Stream.never(),
            reconnect$: Stream.never(),
        },
        state: new StateSource(state$, "state"),
        storage: { local: { getItem: (key: string) =>
            Stream.of(key === storageKeys.priceWidth ? width : { "twap-slices": "3", "twap-interval": "1", "order-size": "0.03" }[key] || "0.01"),
        } },
    } as unknown as Omit<Sources, "router"> & { history: typeof history$ });

    let state: { trade?: TradeState } | undefined;
    const reducers = main.state.subscribe({
        next: (reduce) => {
            state = reduce(state);
            if (state) {
                state$.shamefullySendNext(state);
            }
        },
    });
    const requests: RequestOptions[] = [];
    const polls: AccountRequest[] = [];
    const pages: AccountRequest[] = [];
    const parentDetails = new Map<string, RequestOptions>();
    const http = main.HTTP.subscribe({ next: (request) => {
        const options = request as AccountRequest;
        if (options.category === "parent-orders-page") { pages.push(options); }
        if (options.method === "GET") { polls.push(options); }
        if (options.category === "parent-order") {
            parentDetails.set(new URL(options.url).searchParams.get("parent_order_id")!, options);
        }
        if (["ifdoco-order", "market-order", "limit-order", "stop-order", "twap-order", "cancel-orders", "cancel-parent-order"]
            .includes(options.category as string)) {
            requests.push(options);
            if (writeOrigin) {
                writes$.shamefullySendNext({
                    ...options,
                    credentialVersion: currentCredentialVersion() ?? undefined,
                    url: writeOrigin + new URL(options.url).pathname,
                } as AccountRequest);
            }
        }
    } });
    let vNode: VNode;
    const dom = main.DOM.subscribe({ next: (node) => { vNode = node; } });
    const sounds: Sound[] = [];
    const audio = main.sound!.subscribe({ next: (sound) => sounds.push(sound) });
    if (initialPrice !== null) publishExecution(initialPrice);
    t.after(() => {
        dom.unsubscribe();
        audio.unsubscribe();
        http.unsubscribe();
        reducers.unsubscribe();
    });

    return {
        buy: (category: keyof typeof buy$) => buy$[category].shamefullySendNext(null),
        buyTWAP: () => buyTWAP$.shamefullySendNext(null),
        clearPosition: () => clearPosition$.shamefullySendNext(null),
        get clearPositionDisabled() { return findNode(vNode, "button.clear-button")?.data?.attrs?.disabled; },
        get positionRequests() { return polls.filter(({ category }) => category === "positions"); },
        clearOrders: () => clearOrders$.shamefullySendNext(null),
        enterPrice: (value: string) => priceInput$.shamefullySendNext({ target: { value } }),
        enterTriggerPrice: (value: string) => triggerInput$.shamefullySendNext({ target: { value } }),
        get histories() { return state!.trade!.histories; },
        navigate: (pathname: string) => history$.shamefullySendNext({ pathname }),
        pages,
        parentDetails,
        polls,
        publishExecution,
        requests,
        sounds,
        respondTo(input: AccountRequest) {
            const request = { credentialVersion: currentCredentialVersion() ?? undefined, ...input };
            const response$ = Object.assign(Stream.createWithMemory<Response>(), { request });
            responses$.shamefullySendNext(response$);
            return {
                fail: (error = new Error("Network failure")) => response$.shamefullySendError(error),
                reject: (status = 400) => response$.shamefullySendError({
                    response: { request, status, text: JSON.stringify({ status: -1, error_message: "Order rejected" }) },
                }),
                progress: () => response$.shamefullySendNext({ request } as Response),
                succeed: (body?: unknown) => {
                    response$.shamefullySendNext({ request, status: 200, text: JSON.stringify(body) } as Response);
                    response$.shamefullySendComplete();
                },
            };
        },
        sellStop: () => sellStop$.shamefullySendNext(null),
        sellIFDOCO: () => sellIFDOCO$.shamefullySendNext(null),
        get signingAlert() { return findNode(vNode, "div.order-signing-error"); },
        get state() { return state!.trade!.orderComponentState!; },
        get tradeState() { return state!.trade!; },
    };
}
