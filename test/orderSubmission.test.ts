import {mockDOMSource} from "@cycle/dom";
import {RequestInput, RequestOptions, Response, ResponseStream} from "@cycle/http";
import {MainHTTPSource} from "@cycle/http/lib/cjs/MainHTTPSource";
import {StorageRequest} from "@cycle/storage";
import {StateSource} from "@cycle/state";
import {routerify} from "cyclic-router";
import {deepEqual, equal, match} from "node:assert/strict";
import {once} from "node:events";
import {createServer} from "node:http";
import {createHmac} from "node:crypto";
import {test, TestContext} from "node:test";
import {setImmediate as flush} from "node:timers/promises";
import switchPath from "switch-path";
import Stream, {MemoryStream} from "xstream";
import {makeHTTPDriver} from "../src/drivers/httpDriver";
import {Sound} from "../src/drivers/soundDriver";
import {Root, Sinks, Sources} from "../src/components";
import {State as TradeState} from "../src/components/trade";
import {credentialAwareStorageDriver} from "../src/storage";
import {storageKeys} from "../src/components/trade/order/intent";
import {Execution} from "../src/models/execution";
import type {State as SummaryState} from "../src/components/trade/summary";
import {view as summaryView} from "../src/components/trade/summary/view";
import {cancelOrders, limitOrder, parentOrdersPageSize, stopOrder, twapSliceOrder} from "../src/http";
import {flattenStopOrders} from "../src/models/parentStopOrders";

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
    t.mock.timers.enable({ apis: ["Date"], now: 1000 });
    const order = setup(t);
    order.enterPrice("900");

    order.buy("limit");
    deepEqual(order.requests.map(({ category }) => category), ["limit-order"]);
    equal(order.state.isOrdering, true);

    order.respondTo(order.requests[0]).reject();
    equal(order.state.isOrdering, false);
    deepEqual(order.sounds, ["failure"]);
    deepEqual(order.histories, [{
        createdAt: new Date(1000),
        description: "BUY / 0.01 / 900",
        name: "Limit",
        status: "failed",
    }]);

    order.buy("limit");
    deepEqual(order.requests.map(({ category }) => category), ["limit-order", "limit-order"]);
    equal(order.state.isOrdering, true);
});

test("reports mixed Clear Orders results and stays locked until every request settles", (t) => {
    const order = setup(t);
    order.respondTo({ category: "orders", _namespace: ["trade"] }).succeed([
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
    order.respondTo({ category: "orders", _namespace: ["trade"] }).succeed([
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

test("keeps a parent order visible when its cancellation times out", (t) => {
    const order = setup(t);
    order.respondTo({ url: "https://api.bitflyer.jp/v1/me/getparentorders", category: "parent-orders", _namespace: ["trade"] })
        .succeed([{ parent_order_id: "JCO-timeout" }]);
    order.respondTo(order.parentDetails.get("JCO-timeout")!).succeed({
        parent_order_id: "JCO-timeout",
        parameters: [{ condition_type: "STOP", trigger_price: 200 }],
    });

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

test("ignores Clear Orders results from the previous account", (t) => {
    const order = setup(t, "0.01", { apiKey: "account-a" });
    const parentOrders = order.polls.find(({ category }) => category === "parent-orders")!;
    order.respondTo(parentOrders).succeed([{ parent_order_id: "JCO-old" }]);
    order.clearOrders();
    deepEqual(order.requests.map(({ category }) => category), ["cancel-orders", "cancel-parent-order"]);
    const [bulkCancel, parentCancel] = order.requests;
    const pendingBulkCancel = order.respondTo(bulkCancel);

    order.navigate("/setting");
    order.writeCredential("api-key", "account-b");
    order.navigate("/");
    order.respondTo(parentCancel).fail();
    pendingBulkCancel.succeed();

    equal(order.state.isOrdering, false);
    deepEqual(order.histories, []);
    deepEqual(order.sounds, []);
});

test("clears cached account data and ignores late private responses after switching credentials", (t) => {
    const trade = setup(t, "0.01", { apiKey: "account-a" });
    const positionRequest = () => trade.polls.filter(({ category }) => category === "positions").at(-1)!;
    const ordersRequest = () => trade.polls.filter(({ category }) => category === "orders").at(-1)!;
    const accountA = positionRequest();
    const accountAOrders = ordersRequest();
    trade.respondTo(accountA).succeed([{ side: "BUY", size: 0.25, price: 100 }]);
    trade.respondTo(trade.polls.find(({ category }) => category === "collateral")!)
        .succeed({ collateral: 1000 });
    trade.respondTo(accountAOrders).succeed([{ side: "BUY", size: 0.1, price: 100 }]);
    equal(trade.tradeState.position.size, 0.25);
    equal(trade.tradeState.summaryComponentState!.collateral, 1000);
    equal(trade.tradeState.orders.length, 1);
    const alreadySubscribed = trade.respondTo(accountA);
    const pendingOrders = trade.respondTo(accountAOrders);

    trade.navigate("/setting");
    trade.writeCredential("api-key", "account-b");
    trade.writeCredential("api-secret", "secret-b");
    equal(trade.tradeState.position.size, 0);
    trade.navigate("/");
    const accountB = positionRequest();
    equal((accountB.headers as Record<string, string>)["ACCESS-KEY"], "account-b");
    equal(trade.tradeState.summaryComponentState!.collateral, 0);
    deepEqual(trade.tradeState.orders, []);

    trade.clearPosition();
    trade.clearOrders();
    alreadySubscribed.succeed([{ side: "BUY", size: 0.25, price: 100 }]);
    const fresh = trade.respondTo(accountB);
    trade.respondTo(accountA).succeed([{ side: "BUY", size: 0.25, price: 100 }]);
    pendingOrders.succeed([{ side: "BUY", size: 0.1, price: 100 }]);
    equal(trade.tradeState.position.size, 0);
    deepEqual(trade.tradeState.orders, []);
    trade.clearPosition();
    equal(trade.requests.length, 0);

    fresh.succeed([{ side: "SELL", size: 0.05, price: 110 }]);
    trade.clearPosition();
    equal(trade.requests.length, 1);
    const [order] = trade.requests;
    deepEqual(JSON.parse(order.send as string), {
        child_order_type: "MARKET", product_code: "FX_BTC_JPY", side: "BUY", size: 0.05,
    });
    assertSignature(order, "account-b", "secret-b");
});

test("a pending Clear Position order cannot lock or settle a close on another account", (t) => {
    const trade = setup(t, "0.01", { apiKey: "account-a" });
    const position = [{ side: "BUY", size: 0.08, price: 40000 }];
    trade.respondTo(trade.positionRequests[0]).succeed(position);
    trade.clearPosition();
    const original = trade.respondTo(trade.requests[0]);
    equal(trade.tradeState.positionClose?.settled, false);

    trade.navigate("/setting");
    trade.writeCredential("api-key", "account-b");
    equal(trade.tradeState.positionClose, undefined);
    trade.navigate("/");
    trade.respondTo(trade.positionRequests.at(-1)!).succeed(position);
    trade.clearPosition();
    equal(trade.requests.length, 2);

    original.succeed();
    equal(trade.state.isOrdering, true);
    equal(trade.tradeState.positionClose?.settled, false);
    trade.clearPosition();
    equal(trade.requests.length, 2);
});

test("continues pagination for the current account when an old parent-order list arrives", (t) => {
    const trade = setup(t, "0.01", { apiKey: "account-a" });
    const firstPage = () => trade.polls.filter(({ category }) => category === "parent-orders").at(-1)!;
    const original = firstPage();

    trade.navigate("/setting");
    trade.writeCredential("api-key", "account-b");
    trade.navigate("/");
    const current = trade.respondTo(firstPage());
    const fullPage = Array.from({ length: parentOrdersPageSize }, (_, index) =>
        ({ id: index + 2, parent_order_id: `parent-${index + 2}` }));
    trade.respondTo(original).succeed(fullPage);
    equal(trade.polls.some(({ category }) => category === "parent-orders-page"), false);

    current.succeed(fullPage);
    const pages = trade.polls.filter(({ category }) => category === "parent-orders-page");
    equal(pages.length, 1);
    equal((pages[0].headers as Record<string, string>)["ACCESS-KEY"], "account-b");
    trade.respondTo(pages[0]).succeed([]);
});

test("a pending IFDOCO from the previous account cannot lock or update the new account", (t) => {
    const trade = setup(t, "0.01", { apiKey: "account-a" });
    trade.buy("ifdoco");
    equal(trade.state.isOrdering, true);
    const original = trade.respondTo(trade.requests[0]);

    trade.navigate("/setting");
    trade.writeCredential("api-key", "account-b");
    trade.navigate("/");
    equal(trade.state.isOrdering, false);
    trade.buy("market");
    equal(trade.state.isOrdering, true);

    original.fail();
    equal(trade.state.isOrdering, true);
    equal(trade.histories.length, 0);
    equal(trade.sounds.length, 0);
});

test("rejects a response from before a secret-only change away and back", (t) => {
    const trade = setup(t, "0.01", { apiKey: "account-a" });
    const original = trade.polls.find(({ category }) => category === "positions")!;
    trade.navigate("/setting");
    trade.writeCredential("api-secret", "replacement");
    trade.writeCredential("api-secret", "test");
    trade.navigate("/");
    trade.respondTo(original).succeed([{ side: "BUY", size: 0.25, price: 100 }]);
    trade.clearPosition();
    equal(trade.tradeState.position.size, 0);
    deepEqual(trade.requests, []);
});

function assertSignature(order: RequestOptions, key: string, secret: string) {
    const headers = order.headers as Record<string, string>;
    const query = new URLSearchParams(Object.entries(order.query ?? {}));
    const signed = `${headers["ACCESS-TIMESTAMP"]}${order.method}${new URL(order.url).pathname}?${query}${order.send}`;
    equal(headers["ACCESS-KEY"], key);
    equal(headers["ACCESS-SIGN"], createHmac("sha256", secret).update(signed).digest("hex"));
}

test("keeps Clear Position disabled until a full fill is confirmed", (t) => {
    const order = setup(t);
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

test("uses only the confirmed short remainder after a partial close", (t) => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    const order = setup(t);
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

test("records an HTTP 200 close rejection as a failed order and plays the failure sound", (t) => {
    const order = setup(t);
    order.respondTo(order.positionRequests[0]).succeed([{ side: "BUY", size: 0.08, price: 40000 }]);
    order.clearPosition();

    order.respondTo(order.requests[0]).succeed({ status: -1, error_message: "Order rejected" });

    equal(order.tradeState.positionClose?.settled, true);
    equal(order.tradeState.positionClose?.rejected, true);
    deepEqual(order.histories.map(({ status }) => status), ["failed"]);
    deepEqual(order.sounds, ["failure"]);
});

test("allows retry after a definite rejection and a fresh unchanged position", (t) => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    const order = setup(t);
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
    test(`waits for position reconciliation after an ambiguous ${failure} failure`, (t) => {
        t.mock.timers.enable({ apis: ["setInterval"] });
        const order = setup(t);
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
        const order = setup(t, "0.01", { writeOrigin: `http://127.0.0.1:${address.port}` });
        order.enterPrice("10000");
        const position = [{ side: "BUY", size: 0.08, price: 40000 }];
        if (category === "market-order") order.respondTo(order.positionRequests[0]).succeed(position);
        const refreshOrders = () => order.respondTo(order.polls.filter(({ category }) => category === "orders").at(-1)!)
            .succeed([{ side: "BUY", size: 0.1, price: 10000 }]);
        refreshOrders();
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

        refreshOrders();
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
        const request = twapSliceOrder(0.01, "BUY", Symbol());
        const response = order.respondTo({ ...request, _namespace: ["trade"] });

        if (route === "/setting") order.navigate(route);
        response.fail(Object.assign(new Error("Deadline exceeded"), { code: "ECONNABORTED", errno: "ETIME" }));
        deepEqual(order.histories.map(({ name, status }) => ({ name, status })), [
            { name: "TWAP", status: "unconfirmed" },
        ]);

        if (route === "/setting") order.navigate("/");
        equal(order.histories.length, 1);
        summaryView(Stream.of<SummaryState>({
            ...order.tradeState,
            collateral: 0,
            marketState: { health: "", state: "" },
        })).addListener({ next: (vnode) => match(JSON.stringify(vnode), /Unconfirmed \(timed out\)/) });
    });
}

test("ignores write deadlines from the previous account", (t) => {
    const trade = setup(t);
    const pending = [
        cancelOrders(),
        limitOrder(10000, 0.01, "BUY"),
        stopOrder(110000, 0.01, "BUY"),
        twapSliceOrder(0.01, "BUY", Symbol()),
    ]
        .map((request) => trade.respondTo({ ...request, _namespace: ["trade"] }));

    trade.navigate("/setting");
    trade.writeCredential("api-key", "account-b");
    const timeout = Object.assign(new Error("Deadline exceeded"), { code: "ECONNABORTED", errno: "ETIME" });
    pending.forEach((response) => response.fail(timeout));
    trade.navigate("/");

    deepEqual(trade.histories, []);
    deepEqual(trade.sounds, []);
});

function setup(t: TestContext, width = "0.01", options: {
    apiKey?: string;
    initialPrice?: number | null;
    writeOrigin?: string;
} = {}) {
    const { apiKey = "test", initialPrice = 10000000, writeOrigin } = options;
    const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const credentials: Record<string, string | undefined> = { "api-key": apiKey, "api-secret": "test" };
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: Object.assign(credentials, { setItem: (key: string, value: string) => { credentials[key] = value; } }),
    });
    const storageWrites$ = Stream.create<StorageRequest>();
    const apiKeyInput$ = Stream.create<{target: {value: string}}>();
    const apiSecretInput$ = Stream.create<{target: {value: string}}>();
    credentialAwareStorageDriver(storageWrites$);
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
    const sellIFDOCO$ = Stream.create<null>();
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
        "#trigger-price-input": { input: Stream.of({ target: { value: "110000" } }) },
        ".order-buttons": { ".clear-order-button": { click: clearOrders$ }, ".clear-button": { click: clearPosition$ } },
        ".limit-order-buttons": { ".buy-button": { click: buy$.limit } },
        ".market-order-buttons": { ".buy-button": { click: buy$.market } },
        ".stop-order-buttons": { ".buy-button": { click: buy$.stop } },
        ".ranged-ifdoco-order-buttons": {
            ".buy-button": { click: buy$.ifdoco },
            ".sell-button": { click: sellIFDOCO$ },
        },
    };
    const main: Sinks = routerify(Root, switchPath)({
        DOM: mockDOMSource({ ".___trade": new Proxy({}, { get: (_, selector) =>
            typeof selector === "string" && selector.startsWith(".___cycle") ? orderEvents : undefined,
        }), ".___setting": {
            "#api-key-input": { input: apiKeyInput$ },
            "#api-secret-input": { input: apiSecretInput$ },
        } }),
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
        storage: { local: { getItem: (key: string) => Stream.of(key in credentials ? credentials[key] : key === storageKeys.priceWidth ? width : "0.01") } },
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
    const polls: RequestOptions[] = [];
    const requests: RequestOptions[] = [];
    const parentDetails = new Map<string, RequestOptions>();
    const http = main.HTTP.subscribe({ next: (request) => {
        const options = request as RequestOptions;
        if (options.method === "GET") { polls.push(options); }
        if (options.category === "parent-order") {
            parentDetails.set((options.query as { parent_order_id: string }).parent_order_id, options);
        }
        if (["ifdoco-order", "market-order", "limit-order", "stop-order", "cancel-orders", "cancel-parent-order"]
            .includes(options.category as string)) {
            requests.push(options);
            if (writeOrigin) {
                writes$.shamefullySendNext({ ...options, url: writeOrigin + new URL(options.url).pathname });
            }
        }
    } });
    const sounds: Sound[] = [];
    const storage = main.storage.subscribe({ next: (write) => storageWrites$.shamefullySendNext(write) });
    const audio = main.sound!.subscribe({ next: (sound) => sounds.push(sound) });
    if (initialPrice !== null) publishExecution(initialPrice);
    t.after(() => {
        storage.unsubscribe();
        audio.unsubscribe();
        http.unsubscribe();
        reducers.unsubscribe();
    });

    return {
        buy: (category: keyof typeof buy$) => buy$[category].shamefullySendNext(null),
        clearPosition: () => clearPosition$.shamefullySendNext(null),
        get positionRequests() { return polls.filter(({ category }) => category === "positions"); },
        clearOrders: () => clearOrders$.shamefullySendNext(null),
        enterPrice: (value: string) => priceInput$.shamefullySendNext({ target: { value } }),
        get histories() { return state!.trade!.histories; },
        navigate: (pathname: string) => history$.shamefullySendNext({ pathname }),
        parentDetails,
        polls,
        publishExecution,
        requests,
        writeCredential: (key: "api-key" | "api-secret", value: string) =>
            (key === "api-key" ? apiKeyInput$ : apiSecretInput$).shamefullySendNext({ target: { value } }),
        sounds,
        respondTo(request: RequestOptions) {
            const response$ = Object.assign(Stream.createWithMemory<Response>(), { request: { ...request } });
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
        sellIFDOCO: () => sellIFDOCO$.shamefullySendNext(null),
        get state() { return state!.trade!.orderComponentState!; },
        get tradeState() { return state!.trade!; },
    };
}
