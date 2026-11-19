import {RequestOptions} from "@cycle/http";
import {deepStrictEqual} from "node:assert/strict";
import {createHmac} from "node:crypto";
import {test} from "node:test";
import Stream from "xstream";
import {request as tradeRequest} from "../src/components/trade/request";
import {request as summaryRequest} from "../src/components/trade/summary/request";

const pollers = [
    {
        categories: ["orders", "parent-orders", "positions"],
        requests: () => tradeRequest({
            onCancelParentOrder$: Stream.never(),
            onExecutionBatch$: Stream.never(),
            onMyExecutionCreated$: Stream.never(),
            onOrdersLoaded$: Stream.never(),
            onParentOrderLoaded$: Stream.never(),
            onPositionsLoaded$: Stream.never(),
            onMyOrderChanged$: Stream.never(),
            onParentOrdersLoaded$: Stream.never(),
            parentOrderRequests$: Stream.never(),
        }),
        interval: 10000,
    },
    {
        categories: ["collateral"],
        requests: summaryRequest,
        interval: 15000,
    },
];

pollers.forEach(({categories, requests, interval}) => {
    test(`${categories.join(", ")}: sign the initial request and each tick with current credentials`, (t) => {
        const keys = {"api-key": "initial-key", "api-secret": "initial-secret"};
        const storage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
        Object.defineProperty(globalThis, "localStorage", {configurable: true, value: keys});
        t.after(() => {
            if (storage) {
                Object.defineProperty(globalThis, "localStorage", storage);
            } else {
                Reflect.deleteProperty(globalThis, "localStorage");
            }
        });
        t.mock.timers.enable({apis: ["Date", "setInterval"], now: 1000});

        const stream = requests();
        const emitted: RequestOptions[] = [];
        t.mock.timers.tick(1000);
        const subscription = stream.subscribe({
            next: (input) => {
                if (input && typeof input !== "string" && input.category && categories.includes(input.category)) {
                    emitted.push(input);
                }
            },
        });
        try {
            assertPoll(emitted.splice(0), categories, keys);
            [1, 2].forEach((tick) => {
                keys["api-key"] = `key-${tick}`;
                keys["api-secret"] = `secret-${tick}`;
                t.mock.timers.tick(interval);
                assertPoll(emitted.splice(0), categories, keys);
            });
        } finally {
            subscription.unsubscribe();
        }
    });
});

function assertPoll(requests: RequestOptions[], categories: string[], keys: Record<string, string>): void {
    deepStrictEqual(requests.map(({category}) => category).sort(), [...categories].sort());
    requests.forEach(({headers, method, query, send, url}) => {
        const timestamp = Date.now().toString();
        const path = new URL(url).pathname;
        const queryString = new URLSearchParams(Object.entries(query ?? {}));
        const payload = `${timestamp}${method}${path}?${queryString}${send}`;
        const signature = createHmac("sha256", keys["api-secret"]).update(payload).digest("hex");
        deepStrictEqual(headers, {
            "ACCESS-KEY": keys["api-key"],
            "ACCESS-SIGN": signature,
            "ACCESS-TIMESTAMP": timestamp,
            "Content-Type": "application/json",
        });
    });
}
