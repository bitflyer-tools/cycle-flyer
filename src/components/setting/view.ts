import {button, div, form, h3, input, label, p, VNode} from "@cycle/dom";
import Stream from "xstream";
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
            div(".notifications-enabled", [
                label({ attrs: { for: "notifications-enabled-input" } }, "Desktop notifications"),
                input("#notifications-enabled-input",
                    { props: { type: "checkbox", checked: state.notificationsEnabled } }),
            ]),
        ]),
    );
