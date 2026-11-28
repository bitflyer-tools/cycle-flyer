import Stream from "xstream";
import type {OrderOutcome} from "../components/trade/order/history";

type OrderNotification = {
    operation: "submission" | "cancellation";
    status: OrderOutcome["status"];
};

export type NotificationEvent = "execution" | "price-alert" | OrderNotification;

export const notificationsEnabledStorageKey = "notifications-enabled";

export const makeNotificationDriver = () => (notification$: Stream<NotificationEvent>) => {
    notification$
        .filter((_) => areNotificationsEnabled())
        .addListener({ next: (event) => notify(event) });
};

export const areNotificationsEnabled = (): boolean => localStorage[notificationsEnabledStorageKey] === "true";

const eventMessages = {
    execution: { title: "Execution", body: "Your order was executed." },
    "price-alert": { title: "Price alert", body: "Your price alert condition was met." },
};

const orderMessages = {
    submission: {
        success: { title: "Order accepted", body: "bitFlyer accepted your order." },
        failed: { title: "Order rejected", body: "bitFlyer rejected your order." },
        unconfirmed: { title: "Order unconfirmed", body: "Could not confirm whether bitFlyer accepted your order." },
    },
    cancellation: {
        success: { title: "Cancellation confirmed", body: "bitFlyer confirmed your cancellation request." },
        failed: { title: "Cancellation rejected", body: "bitFlyer rejected your cancellation request." },
        unconfirmed: {
            title: "Cancellation unconfirmed",
            body: "Could not confirm whether bitFlyer accepted your cancellation request.",
        },
    },
} satisfies Record<OrderNotification["operation"], Record<OrderNotification["status"], { title: string; body: string }>>;

const notify = (event: NotificationEvent): void => {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") { return; }
    const { title, body } = typeof event === "string"
        ? eventMessages[event]
        : orderMessages[event.operation][event.status];
    new Notification(title, { body });
};
