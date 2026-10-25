import {div, VNode} from "@cycle/dom";
import Stream from "xstream";

export const view = (
    boardComponentDOM$: Stream<VNode>,
    summaryComponentDOM$: Stream<VNode>,
    orderComponentDOM$: Stream<VNode>,
): Stream<VNode> =>
    Stream.combine(summaryComponentDOM$, boardComponentDOM$, orderComponentDOM$)
        .map((componentDOMs) => div(".trade", componentDOMs));
