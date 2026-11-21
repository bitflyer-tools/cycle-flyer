import {button, div, h2, p, section, table, tbody, td, th, thead, tr, VNode} from "@cycle/dom";
import {Execution, State} from "./index";

export const view = (state: State): VNode => section(".executions", { attrs: { "aria-label": "Executions" } }, [
    h2("Executions"),
    button(".refresh-executions", { props: { disabled: state.loading } },
        state.loaded ? "Refresh" : "Load executions"),
    button(".load-older-executions", { props: { disabled: state.loading || state.before === undefined } }, "Load older"),
    state.error ? p({ attrs: { role: "alert" } }, state.error) : null,
    p(".executions-status", { attrs: { role: "status" } }, status(state)),
    state.rows.length ? div(".executions-scroll", { attrs: { tabindex: "0", "aria-label": "Execution rows" } }, [
        table([
            thead([tr(["Exchange time", "Side", "Price (JPY)", "Size (bFX)", "Order acceptance ID"]
                .map((label) => th({ attrs: { scope: "col" } }, label)))]),
            tbody(state.rows.map(row)),
        ]),
    ]) : null,
]);

const row = (execution: Execution): VNode => tr({ key: execution.id }, [
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
