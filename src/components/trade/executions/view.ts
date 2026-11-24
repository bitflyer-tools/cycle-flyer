import {button, div, h2, p, section, table, tbody, td, th, thead, tr, VNode} from "@cycle/dom";
import {Execution, State} from "./index";

const rowHeight = 28;
const viewportHeight = 260;
const overscan = 4;

export const view = (state: State, scrollTop: number): VNode => section(".executions", { attrs: { "aria-label": "Executions" } }, [
    h2("Executions"),
    button(".refresh-executions", { props: { disabled: state.loading } },
        state.loaded ? "Refresh" : "Load executions"),
    button(".load-older-executions", { props: { disabled: state.loading || state.before === undefined } }, "Load older"),
    state.error ? p({ attrs: { role: "alert" } }, state.error) : null,
    p(".executions-status", { attrs: { role: "status" } }, status(state)),
    state.rows.length ? div(".executions-scroll", {
        attrs: { tabindex: "0", "aria-label": "Execution rows" },
        style: { "--execution-row-height": `${rowHeight}px`, maxHeight: `${viewportHeight}px` },
    }, [
        table({ attrs: { "aria-rowcount": state.rows.length + 1 } }, [
            thead([tr({ attrs: { "aria-rowindex": 1 } }, ["Exchange time", "Side", "Price (JPY)", "Size (BTC-CFD)", "Order acceptance ID"]
                .map((label) => th({ attrs: { scope: "col" } }, label)))]),
            tbody(windowRows(state.rows, scrollTop)),
        ]),
    ]) : null,
]);

const windowRows = (rows: Execution[], scrollTop: number): VNode[] => {
    const visibleCount = Math.ceil(viewportHeight / rowHeight);
    const firstVisible = Math.min(Math.floor(Math.max(0, scrollTop) / rowHeight),
        Math.max(0, rows.length - visibleCount));
    const start = Math.max(0, firstVisible - overscan);
    const end = Math.min(rows.length, firstVisible + visibleCount + 1 + overscan);
    const visibleRows = rows.slice(start, end).map((execution, offset) => row(execution, start + offset + 2));
    return [spacer("before", start), ...visibleRows, spacer("after", rows.length - end)];
};

const spacer = (key: string, count: number): VNode => tr(".executions-spacer", { key, attrs: { "aria-hidden": "true" } }, [
    td({ attrs: { colspan: "5" }, style: { height: `${count * rowHeight}px` } }),
]);

const row = (execution: Execution, rowIndex: number): VNode => tr({
    key: execution.id,
    attrs: { "aria-rowindex": rowIndex },
}, [
    td(execution.exec_date),
    td(execution.side),
    td(execution.price.toLocaleString(undefined, { maximumFractionDigits: 20 })),
    td(String(execution.size)),
    td(execution.child_order_acceptance_id),
]);

const status = (state: State): string => {
    if (state.loading) { return "Loading executions…"; }
    if (!state.loaded || state.error) { return ""; }
    return state.rows.length ? "" : "No executions found.";
};
