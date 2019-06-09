import {div, h3, input, label, VNode} from "@cycle/dom";
import Stream from "xstream";
import {State} from "./model";

export const view = (state$: Stream<State>): Stream<VNode> =>
    state$.map((state) =>
        div(".setting", [
            h3(".title", "Setting"),
            div(".api-key", [
                label({ attrs: { for: "api-key-input" } }, "API Key"),
                input("#api-key-input", { props: { type: "text" }, attrs: { value: state.apiKey } }),
            ]),
            div(".api-secret", [
                label({ attrs: { for: "api-secret-input" } }, "API Secret"),
                input("#api-secret-input", { props: { type: "text" }, attrs: { value: state.apiSecret } }),
            ]),
        ]),
    );
