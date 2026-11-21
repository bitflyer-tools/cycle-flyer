import {MainDOMSource} from "@cycle/dom";
import {HTTPSource, Response} from "@cycle/http";
import {Reducer, StateSource} from "@cycle/state";
import Stream from "xstream";
import sampleCombine from "xstream/extra/sampleCombine";
import {executionPageSize, getExecutions} from "../../../http";
import {privateResponses} from "../privateResponses";
import {view} from "./view";

export interface Execution {
    id: number;
    exec_date: string;
    side: string;
    price: number;
    size: number;
    child_order_acceptance_id: string;
}

export interface State {
    rows: Execution[];
    before?: number;
    loaded: boolean;
    loading: boolean;
    error?: string;
}

interface Sources {
    DOM: MainDOMSource;
    HTTP: HTTPSource;
    state: StateSource<State>;
}

const initialState: State = { rows: [], loaded: false, loading: false };

export const ExecutionsComponent = ({DOM, HTTP, state}: Sources) => {
    const requests$ = Stream.merge(
        DOM.select(".refresh-executions").events("click").mapTo(false),
        DOM.select(".load-older-executions").events("click").mapTo(true),
    ).compose(sampleCombine(state.stream))
        .filter(([older, current]) => !current.loading && (!older || current.before !== undefined))
        .map(([older, current]) => getExecutions(older ? current.before : undefined));

    const responses$ = privateResponses(HTTP, "executions")
        .map((response$) => {
            const {before} = response$.request.query as {before?: number};
            return response$.map((response): Reducer<State> => pageLoaded(readPage(response), before))
                .replaceError((error) => Stream.of(loadFailed(errorMessage(error))));
        }).flatten();

    return {
        DOM: state.stream.map(view),
        HTTP: requests$.filter((request) => request !== null),
        state: Stream.merge<Reducer<State>>(
            Stream.of<Reducer<State>>(() => initialState),
            requests$.map<Reducer<State>>((request) => request
                ? (current = initialState) => ({ ...current, loading: true, error: undefined })
                : loadFailed("Set an API key and secret in Setting to read executions.")),
            responses$,
        ),
    };
};

const pageLoaded = (page: Execution[], before?: number): Reducer<State> => (state = initialState) => {
    const rows = before === undefined ? [] : state.rows.slice();
    const seen = new Set(rows.map((row) => row.id));
    const ordered = page.filter((row) => before === undefined || row.id < before)
        .sort((a, b) => b.id - a.id);
    ordered.forEach((row) => {
        if (seen.has(row.id)) { return; }
        rows.push(row);
        seen.add(row.id);
    });
    return {
        rows,
        before: page.length >= executionPageSize ? ordered[ordered.length - 1]?.id : undefined,
        loaded: true,
        loading: false,
    };
};

const readPage = (response: Response): Execution[] => {
    const page: unknown = JSON.parse(response.text);
    if (!Array.isArray(page) || !page.every((row) => row && Number.isSafeInteger(row.id) &&
        typeof row.exec_date === "string" && typeof row.side === "string" &&
        Number.isFinite(row.price) && Number.isFinite(row.size) &&
        typeof row.child_order_acceptance_id === "string")) {
        throw new Error("Invalid executions response.");
    }
    return page;
};

const loadFailed = (error: string): Reducer<State> => (state = initialState) => ({ ...state, error, loading: false });

const errorMessage = (error: any): string => {
    const status = error?.status ?? error?.response?.status;
    if (status === 401 || status === 403 ||
        /permission|access denied|not authorized/i.test(error?.response?.body?.error_message ?? "")) {
        return "Check your API key and secret in Setting and enable permission to read executions in bitFlyer.";
    }
    return "Could not load executions. Try again.";
};
