import assert from "node:assert/strict";
import {test, TestContext} from "node:test";
import Stream from "xstream";
import {areNotificationsEnabled, makeNotificationDriver, notificationsEnabledStorageKey} from "../src/drivers/notificationDriver";
import {Sound} from "../src/drivers/soundDriver";

function withLocalStorage(t: TestContext, value: Record<string, string>): void {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value });
    t.after(() => {
        if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
        else Reflect.deleteProperty(globalThis, "localStorage");
    });
}

function withNotification(t: TestContext, permission: string, shown: { title: string; body?: string }[]): void {
    const original = (globalThis as any).Notification;
    (globalThis as any).Notification = class {
        static permission = permission;
        constructor(title: string, options?: { body?: string }) { shown.push({ title, body: options?.body }); }
    };
    t.after(() => { (globalThis as any).Notification = original; });
}

test("notifications are disabled unless the stored flag is exactly \"true\"", (t) => {
    withLocalStorage(t, {});
    assert.equal(areNotificationsEnabled(), false);
});

test("notifications are enabled once the flag is stored as \"true\"", (t) => {
    withLocalStorage(t, { [notificationsEnabledStorageKey]: "true" });
    assert.equal(areNotificationsEnabled(), true);
});

test("the driver shows a notification when enabled and permission is granted", (t) => {
    withLocalStorage(t, { [notificationsEnabledStorageKey]: "true" });
    const shown: { title: string; body?: string }[] = [];
    withNotification(t, "granted", shown);

    const notification$ = Stream.create<Sound>();
    makeNotificationDriver()(notification$);
    notification$.shamefullySendNext("price-alert");

    assert.deepEqual(shown, [{ title: "Price alert", body: "Your price alert condition was met." }]);
});

test("the driver stays silent when notifications are disabled", (t) => {
    withLocalStorage(t, {});
    const shown: { title: string; body?: string }[] = [];
    withNotification(t, "granted", shown);

    const notification$ = Stream.create<Sound>();
    makeNotificationDriver()(notification$);
    notification$.shamefullySendNext("success");

    assert.deepEqual(shown, []);
});

test("the driver stays silent when permission has not been granted", (t) => {
    withLocalStorage(t, { [notificationsEnabledStorageKey]: "true" });
    const shown: { title: string; body?: string }[] = [];
    withNotification(t, "denied", shown);

    const notification$ = Stream.create<Sound>();
    makeNotificationDriver()(notification$);
    notification$.shamefullySendNext("execution");

    assert.deepEqual(shown, []);
});

test("the driver stays silent outside a Notification-capable environment", (t) => {
    withLocalStorage(t, { [notificationsEnabledStorageKey]: "true" });
    const original = (globalThis as any).Notification;
    delete (globalThis as any).Notification;
    t.after(() => { (globalThis as any).Notification = original; });

    const notification$ = Stream.create<Sound>();
    assert.doesNotThrow(() => {
        makeNotificationDriver()(notification$);
        notification$.shamefullySendNext("failure");
    });
});
