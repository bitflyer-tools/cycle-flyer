import {button, div, form, input, option, select, VNode} from "@cycle/dom";
import {PriceAlert} from "../priceAlert";

export const priceAlertView = (alert: PriceAlert | null): VNode =>
    div(".price-alert", [
        div(".price-alert-status", { attrs: { role: "status" } }, statusText(alert)),
        alert?.status === "active" ? dismissButton() : alertForm(),
        ...(alert?.status === "triggered" ? [dismissButton()] : []),
    ]);

const alertForm = (): VNode =>
    form(".price-alert-form", [
        input({ attrs: {
            "aria-label": "Alert price (JPY)",
            name: "threshold",
            type: "number",
            min: "1",
            max: Number.MAX_SAFE_INTEGER.toString(),
            step: "1",
            required: true,
            placeholder: "Price (JPY)",
        } }),
        select({ attrs: { "aria-label": "Crossing direction", name: "direction" } }, [
            option({ attrs: { value: "up" } }, "Crosses up"),
            option({ attrs: { value: "down" } }, "Crosses down"),
        ]),
        button({ attrs: { type: "submit" } }, "Set alert"),
    ]);

const dismissButton = (): VNode =>
    button(".dismiss-price-alert", { attrs: { type: "button" } }, "Dismiss alert");

const statusText = (alert: PriceAlert | null): string => {
    if (!alert) { return "Price alert"; }

    const direction = alert.direction === "up" ? "up" : "down";
    const threshold = alert.threshold.toLocaleString();
    if (alert.status === "active") {
        return `Active while Trade is open · Crosses ${direction} at ${threshold} JPY`;
    }

    return `Alert triggered at ${alert.price.toLocaleString()} JPY · ${alert.time.toLocaleTimeString()}`;
};
