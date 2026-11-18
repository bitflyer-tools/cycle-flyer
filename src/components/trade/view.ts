import {div, VNode} from "@cycle/dom";
import Stream from "xstream";

export const view = (
    boardComponentDOM$: Stream<VNode>,
    summaryComponentDOM$: Stream<VNode>,
    orderComponentDOM$: Stream<VNode>,
    executionsComponentDOM$: Stream<VNode>,
): Stream<VNode> =>
    Stream.combine(summaryComponentDOM$, boardComponentDOM$, orderComponentDOM$, executionsComponentDOM$)
        .map(([summary, board, order, executions]) => div(".trade", [
            div(".trade-sidebar", [executions, summary]), board, order,
        ]));
