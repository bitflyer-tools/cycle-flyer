import {div, VNode} from "@cycle/dom";
import Stream from "xstream";

export const view = (
    boardComponentDOM$: Stream<VNode>,
    summaryComponentDOM$: Stream<VNode>,
    orderComponentDOM$: Stream<VNode>,
    executionsComponentDOM$: Stream<VNode>,
    recentTradesDOM$: Stream<VNode>,
): Stream<VNode> =>
    Stream.combine(summaryComponentDOM$, boardComponentDOM$, orderComponentDOM$, executionsComponentDOM$,
        recentTradesDOM$)
        .map(([summary, board, order, executions, recentTrades]) => div(".trade", [
            div(".trade-sidebar", [summary, executions]), board, order, recentTrades,
        ]));
