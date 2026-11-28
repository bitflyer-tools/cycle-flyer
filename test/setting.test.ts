import assert from "node:assert/strict";
import {test, TestContext} from "node:test";
import {mockDOMSource} from "@cycle/dom";
import {StateSource} from "@cycle/state";
import {StorageRequest} from "@cycle/storage";
import {routerify} from "cyclic-router";
import switchPath from "switch-path";
import Stream from "xstream";
import {Root, Sources as RootSources} from "../src/components";
import {Setting, Sources} from "../src/components/setting";
import {State} from "../src/components/setting/model";
import {notificationsEnabledStorageKey} from "../src/drivers/notificationDriver";

function setup(t: TestContext, stored: Record<string, string> = {}) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {} });
    t.after(() => {
        if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
        else Reflect.deleteProperty(globalThis, "localStorage");
    });

    const soundToggle$ = Stream.create<{ target: { checked: boolean } }>();
    const notificationsToggle$ = Stream.create<{ target: { checked: boolean } }>();
    const state$ = Stream.createWithMemory<State>();

    const sinks = Setting({
        DOM: mockDOMSource({
            "#clear-credentials": { click: Stream.never() },
            "#credentials-form": { submit: Stream.never() },
            "#notifications-enabled-input": { change: notificationsToggle$ },
            "#sound-enabled-input": { change: soundToggle$ },
        }) as unknown as Sources["DOM"],
        HTTP: { select: () => Stream.never() } as unknown as Sources["HTTP"],
        router: {} as unknown as Sources["router"],
        state: new StateSource(state$, "state"),
        storage: { local: { getItem: (key: string) => Stream.of(stored[key] ?? null) } } as unknown as Sources["storage"],
    });

    let state: State | undefined;
    const requests: StorageRequest[] = [];
    const subscriptions = [
        sinks.state.subscribe({ next: (reduce) => {
            state = reduce(state);
            state$.shamefullySendNext(state!);
        } }),
        sinks.storage.subscribe({ next: (request) => requests.push(request) }),
    ];
    t.after(() => subscriptions.forEach((subscription) => subscription.unsubscribe()));

    return {
        get state() { return state!; },
        requests,
        toggleNotifications: (checked: boolean) => notificationsToggle$.shamefullySendNext({ target: { checked } }),
        toggleSound: (checked: boolean) => soundToggle$.shamefullySendNext({ target: { checked } }),
    };
}

test("desktop notifications are disabled by default", (t) => {
    const settings = setup(t);
    assert.equal(settings.state.notificationsEnabled, false);
});

test("a previously stored notifications-enabled flag is loaded on start", (t) => {
    const settings = setup(t, { [notificationsEnabledStorageKey]: "true" });
    assert.equal(settings.state.notificationsEnabled, true);
});

test("toggling the desktop notifications checkbox updates state and storage independently of sound", (t) => {
    const settings = setup(t);
    settings.toggleNotifications(true);
    assert.equal(settings.state.notificationsEnabled, true);
    assert.equal(settings.state.soundEnabled, true);
    assert.deepEqual(settings.requests, [{ key: notificationsEnabledStorageKey, value: "true" }]);

    settings.toggleSound(false);
    assert.equal(settings.state.soundEnabled, false);
    assert.equal(settings.state.notificationsEnabled, true);
});

test("enabling notifications requests permission once, but not again once decided", (t) => {
    const permissionRequests: unknown[] = [];
    const original = (globalThis as any).Notification;
    (globalThis as any).Notification = class {
        static permission = "default";
        static requestPermission = () => {
            permissionRequests.push(undefined);
            (globalThis as any).Notification.permission = "granted";
            return Promise.resolve("granted");
        };
    };
    t.after(() => { (globalThis as any).Notification = original; });

    const settings = setup(t);
    settings.toggleNotifications(true);
    assert.equal(permissionRequests.length, 1);

    settings.toggleNotifications(false);
    settings.toggleNotifications(true);
    assert.equal(permissionRequests.length, 1);
});

test("disabling notifications does not request permission", (t) => {
    const permissionRequests: unknown[] = [];
    const original = (globalThis as any).Notification;
    (globalThis as any).Notification = class {
        static permission = "default";
        static requestPermission = () => { permissionRequests.push(undefined); return Promise.resolve("denied"); };
    };
    t.after(() => { (globalThis as any).Notification = original; });

    const settings = setup(t);
    settings.toggleNotifications(false);
    assert.equal(permissionRequests.length, 0);
});

test("only the active Settings route requests notification permission", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const requestPermission = t.mock.fn(async () => "default");
    const original = Object.getOwnPropertyDescriptor(globalThis, "Notification");
    Object.defineProperty(globalThis, "Notification", {
        configurable: true, value: { permission: "default", requestPermission },
    });
    t.after(() => {
        if (original) Object.defineProperty(globalThis, "Notification", original);
        else Reflect.deleteProperty(globalThis, "Notification");
    });

    const stop = t.mock.fn();
    const change$ = Stream.create<{ target: { checked: boolean } }>({ start() {}, stop });
    const dom = (selector = "") => ({
        select: (next: string) => dom(next),
        events: (type: string) =>
            selector === "#notifications-enabled-input" && type === "change" ? change$ : Stream.never(),
    });
    const history = Stream.create<{ pathname: string }>();
    const app = routerify(Root, switchPath);
    const sinks = app({
        DOM: dom() as RootSources["DOM"],
        HTTP: { select: () => Stream.never() } as unknown as RootSources["HTTP"],
        history,
        socket: {
            connected$: Stream.of(false),
            board$: Stream.never(),
            childOrderEvent$: Stream.never(),
            executionBatch$: Stream.never(),
            parentOrderEvent$: Stream.never(),
            reconnect$: Stream.never(),
        },
        state: new StateSource(Stream.create<object>(), "state"),
        storage: { local: { getItem: () => Stream.of(null) } } as unknown as RootSources["storage"],
    });
    const subscription = sinks.storage.subscribe({ next() {} });
    t.after(() => subscription.unsubscribe());
    const navigate = (pathname: string) => {
        history.shamefullySendNext({ pathname });
        t.mock.timers.runAll();
    };

    navigate("/");
    navigate("/setting");
    navigate("/");
    navigate("/setting");
    navigate("/");
    navigate("/setting");

    change$.shamefullySendNext({ target: { checked: true } });
    assert.equal(requestPermission.mock.callCount(), 1);

    navigate("/");
    change$.shamefullySendNext({ target: { checked: true } });
    assert.equal(requestPermission.mock.callCount(), 1);
    assert.equal(stop.mock.callCount(), 3);
});
