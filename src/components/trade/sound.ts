import Stream from "xstream";
import dropRepeats from "xstream/extra/dropRepeats";
import {Sound} from "../../drivers/soundDriver";
import {OrderHistory} from "../../models/orderHistory";
import {State} from "./index";

export const sound = (state$: Stream<State>): Stream<Sound> =>
    state$
        .filter((state) => !!state)
        .map((state) => state.histories[0])
        .compose(dropRepeats())
        .drop(1)
        .filter((history) => !!history)
        .map(soundFor);

const soundFor = (history: OrderHistory): Sound => {
    if (history.status !== "success") { return "failure"; }
    return history.name === "Executed" ? "execution" : "success";
};
