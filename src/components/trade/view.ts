import {div, p} from "@cycle/dom";
import Stream from "xstream";
import {State} from "./model";

export const view = (state$: Stream<State>) =>
    state$.map(state =>
        div(".trade", [
            p(state.currentPrice),
        ])
    );
