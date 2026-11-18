import {Response} from "@cycle/http";
import {Reducer} from "@cycle/state";
import Stream from "xstream";
import {Board} from "../../../models/board";
import {State} from "./index";

interface PendingSnapshot {
    deltas: Board[];
    board?: Board;
}

export const synchronizeBoard = <T extends Stream<Response>>(
    updates$: Stream<object>,
    responses$$: Stream<T>,
): Stream<Reducer<State>> => {
    const deltas$ = updates$.map((json) => new Board(json));
    const liveReducer$ = deltas$
        .map<Reducer<State>>((delta) => (state) => state && ({ ...state, board: mergeDelta(state.board, delta) }));

    // Each response stream is announced at request time. Switching drops superseded requests.
    const snapshotReducer$ = responses$$
        .map((response$) => reconcileSnapshot(response$, deltas$))
        .flatten()
        .map<Reducer<State>>((board) => (state) => state && ({ ...state, board }));

    return Stream.merge(liveReducer$, snapshotReducer$);
};

const reconcileSnapshot = (response$: Stream<Response>, deltas$: Stream<Board>): Stream<Board> => {
    const updates$ = deltas$.map((delta) => (pending: PendingSnapshot) => {
        pending.deltas.push(delta);
        return pending;
    });
    const snapshot$ = response$.map((response) => (pending: PendingSnapshot) => ({
        ...pending,
        board: pending.deltas.reduce(mergeDelta, new Board(JSON.parse(response.text))),
    }));

    return Stream.merge(updates$, snapshot$)
        .fold((pending, update) => update(pending), { deltas: [] } as PendingSnapshot)
        .map((pending) => pending.board)
        .filter((board): board is Board => !!board)
        .take(1)
        .replaceError(() => Stream.empty());
};

const mergeDelta = (board: Board, delta: Board): Board => board.merge(delta.asks, delta.bids);
