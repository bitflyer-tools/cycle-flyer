import {button, div, form, h3, input, label, option, p, select, VNode} from "@cycle/dom";
import Stream from "xstream";
import {defaultAccountType, maximumOrderSizeByAccountType} from "../../models/order";
import {State} from "./model";

export const view = (state$: Stream<State>): Stream<VNode> =>
    state$.map((state) =>
        div(".setting", [
            h3(".title", "Setting"),
            form("#credentials-form", { attrs: { autocomplete: "off" } }, [
                div(".api-key", [
                    label({ attrs: { for: "api-key-input" } }, "API Key"),
                    input("#api-key-input", { props: { name: "key", required: true, type: "text" } }),
                ]),
                div(".api-secret", [
                    label({ attrs: { for: "api-secret-input" } }, "API Secret"),
                    input("#api-secret-input", {
                        attrs: { autocomplete: "new-password" },
                        props: { name: "secret", required: true, type: "password" },
                    }),
                ]),
                button({ props: { type: "submit" } }, "Save credentials"),
                button("#clear-credentials", { props: { type: "button" } }, "Clear credentials"),
                p({ attrs: { role: "status" } }, state.credentialsMessage),
            ]),
            div(".sound-enabled", [
                label({ attrs: { for: "sound-enabled-input" } }, "Sound"),
                input("#sound-enabled-input", { props: { type: "checkbox", checked: state.soundEnabled } }),
            ]),
            div(".account-type", [
                label({ attrs: { for: "account-type-input" } }, "Account type"),
                select("#account-type-input", { props: { value: state.accountType ?? defaultAccountType } }, [
                    option({ props: { value: "individual" } },
                        `Individual (max ${maximumOrderSizeByAccountType.individual} BTC-CFD per order)`),
                    option({ props: { value: "corporate" } },
                        `Corporate (max ${maximumOrderSizeByAccountType.corporate} BTC-CFD per order)`),
                ]),
            ]),
        ]),
    );
