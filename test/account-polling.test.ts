import {RequestOptions} from "@cycle/http";
import {deepStrictEqual} from "node:assert/strict";
import {createHmac} from "node:crypto";
import {test} from "node:test";
import Stream from "xstream";
import {saveCredentials} from "../src/credentials";
import {authorizeRequest} from "../src/drivers/httpDriver";
import {request as tradeRequest} from "../src/components/trade/request";
import {request as summaryRequest} from "../src/components/trade/summary/request";

const pollers = [
    {
        categories: ["orders", "parent-orders", "positions"],
        requests: (settled$: Stream<null>) => tradeRequest({
            onCancelOrders$: Stream.never(),
            onCancelParentOrder$: Stream.never(),
            onExecutionBatch$: Stream.never(),
            onMyExecutionCreated$: Stream.never(),
            onOrdersLoaded$: Stream.never(),
            onParentOrderLoaded$: Stream.never(),
            onPositionsLoaded$: Stream.never(),
            onMyOrderChanged$: Stream.never(),
            onParentOrdersLoaded$: Stream.never(),
            onParentOrderListSettled$: settled$,
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
    test(`${categories.join(", ")}: sign the initial request and each tick with current credentials`, async (t) => {
        const keys = { key: "initial-key", secret: "initial-secret" };
        const storage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
        Object.defineProperty(globalThis, "localStorage", {configurable: true, value: { getItem: () => null, removeItem() {} }});
        t.after(() => {
            if (storage) {
                Object.defineProperty(globalThis, "localStorage", storage);
            } else {
                Reflect.deleteProperty(globalThis, "localStorage");
            }
        });
        t.mock.timers.enable({apis: ["Date", "setInterval"], now: 1000});

        await saveCredentials(keys);
        const settled$ = Stream.create<null>();
        const stream = requests(settled$);
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
            await assertPoll(emitted.splice(0), categories, keys);
            settled$.shamefullySendNext(null);
            t.mock.timers.tick(interval);
            await assertPoll(emitted.splice(0), categories, keys);
            settled$.shamefullySendNext(null);

            const replacement = { key: "replacement-key", secret: "replacement-secret" };
            await saveCredentials(replacement);
            await assertPoll(emitted.splice(0), categories, replacement);
        } finally {
            subscription.unsubscribe();
        }
    });
});

async function assertPoll(requests: RequestOptions[], categories: string[], keys: { key: string; secret: string }) {
    deepStrictEqual(requests.map(({category}) => category).sort(), [...categories].sort());
    await Promise.all(requests.map(async (request) => {
        const {headers, method, send, url} = await authorizeRequest(request) as RequestOptions;
        const timestamp = Date.now().toString();
        const {pathname, search} = new URL(url);
        const payload = `${timestamp}${method}${pathname}${search}${send}`;
        const signature = createHmac("sha256", keys.secret).update(payload).digest("hex");
        deepStrictEqual(headers, {
            "ACCESS-KEY": keys.key,
            "ACCESS-SIGN": signature,
            "ACCESS-TIMESTAMP": timestamp,
            "Content-Type": "application/json",
        });
    }));
}
