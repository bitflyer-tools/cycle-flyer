import Stream from "xstream";
import {Sound} from "./soundDriver";

export const notificationsEnabledStorageKey = "notifications-enabled";

export const makeNotificationDriver = () => (notification$: Stream<Sound>) => {
    notification$
        .filter((_) => areNotificationsEnabled())
        .addListener({ next: (sound) => notify(sound) });
};

export const areNotificationsEnabled = (): boolean => localStorage[notificationsEnabledStorageKey] === "true";

const messages: { [sound in Sound]: { title: string; body: string } } = {
    execution: { title: "Execution", body: "Your order was executed." },
    failure: { title: "Order failed", body: "Your order could not be completed." },
    success: { title: "Order filled", body: "Your order was filled." },
    "price-alert": { title: "Price alert", body: "Your price alert condition was met." },
};

const notify = (sound: Sound): void => {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") { return; }
    const { title, body } = messages[sound];
    new Notification(title, { body });
};
