import {DOMSource, VNode} from "@cycle/dom";
import {HTTPSource, RequestInput} from "@cycle/http";
import {Reducer, StateSource} from "cycle-onionify";
import Stream from "xstream";
import {model} from "./model";
import {HistoryAction, RouterSource} from 'cyclic-router';
import {StorageRequest, StorageSource} from "@cycle/storage";
import {PubnubSource} from "../../drivers/pubnubDriver";
import {intent} from "./intent";
import {request} from "./request";
import {view} from "./view";
import {State as SummaryComponentState} from "./summary";
import {Summary} from "./summary/index";
import isolate from "@cycle/isolate";
import {Board} from "../../models/board";
import {OrderHistory} from "../../models/orderHistory";
import {Order} from "../../models/order";
import {Position} from "../../models/position";

export interface Sources {
    DOM: DOMSource;
    HTTP: HTTPSource;
    onion: StateSource<object>;
    pubnub: PubnubSource;
    router: RouterSource;
    storage: StorageSource;
}

export interface Sinks {
    DOM: Stream<VNode>;
    HTTP: Stream<RequestInput|null>;
    onion: Stream<Reducer<object>>;
    router: Stream<HistoryAction>;
    storage: Stream<StorageRequest>;
}

export interface State {
    board: Board;
    currentPrice: number;
    groupedSize: number;
    histories: OrderHistory[];
    isOrdering: boolean;
    orders: Order[];
    position: Position;
    price: number;
    size: number;
    summaryComponentState?: SummaryComponentState
}

export const Trade = (sources: Sources): Sinks => {
    const summaryComponent = isolate(Summary, {
        "*": "summaryComponent",
        "onion": {
            get: (state: State) => state.summaryComponentState && {
                ...state.summaryComponentState,
                currentPrice: state.currentPrice,
                histories: state.histories,
                position: state.position
            },
            set: (state: State, summaryComponentState: SummaryComponentState) => ({
                ...state,
                summaryComponentState,
                position: summaryComponentState.position
            })
        }
    })(sources);

    const actions = intent(sources);
    const reducer$ = model(actions);
    const view$ = view(sources.onion.state$, summaryComponent.DOM);
    const request$ = request(actions, sources.onion.state$);

    return {
        DOM: view$,
        HTTP: Stream.merge(request$, summaryComponent.HTTP),
        onion: Stream.merge(reducer$, summaryComponent.onion),
        router: Stream.empty(),
        storage: Stream.empty()
    }
};
