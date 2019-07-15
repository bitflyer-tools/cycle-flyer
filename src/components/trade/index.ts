import {DOMSource, VNode} from "@cycle/dom";
import {HTTPSource, RequestInput} from "@cycle/http";
import isolate from "@cycle/isolate";
import {Reducer, StateSource} from "@cycle/state";
import {StorageRequest, StorageSource} from "@cycle/storage";
import {RouterSource} from "cyclic-router";
import Stream from "xstream";
import {SocketIOSource} from "../../drivers/socketIODriver";
import {IFDOCOrder} from "../../models/ifdocoOrder";
import {Order} from "../../models/order";
import {OrderHistory} from "../../models/orderHistory";
import {Position} from "../../models/position";
import {StopOrder} from "../../models/stopOrder";
import {BoardComponent, State as BoardComponentState} from "./board/index";
import "./index.styl";
import {intent} from "./intent";
import {model} from "./model";
import {request} from "./request";
import {State as SummaryComponentState} from "./summary";
import {SummaryComponent} from "./summary";
import {view} from "./view";

export interface Sources {
    DOM: DOMSource;
    HTTP: HTTPSource;
    state: StateSource<State>;
    router: RouterSource;
    socket: SocketIOSource;
    storage: StorageSource;
}

export interface Sinks {
    DOM: Stream<VNode>;
    HTTP: Stream<RequestInput|null>;
    state: Stream<Reducer<State>>;
    router: Stream<void>;
    storage: Stream<StorageRequest>;
}

export interface State {
    currentPrice: number;
    histories: OrderHistory[];
    ifdocoOrder: IFDOCOrder;
    isOrdering: boolean;
    orders: Order[];
    position: Position;
    price: number;
    size: number;
    stopOrders: StopOrder[];
    boardComponentState?: BoardComponentState;
    summaryComponentState?: SummaryComponentState;
}

export const Trade = (sources: Sources): Sinks => {
    const summaryComponent = isolate(SummaryComponent, {
        state: {
            get: (state: State) => state.summaryComponentState && {
                ...state.summaryComponentState,
                currentPrice: state.currentPrice,
                histories: state.histories,
                position: state.position,
            },
            set: (state: State, summaryComponentState: SummaryComponentState) => ({
                ...state,
                position: summaryComponentState.position,
                summaryComponentState,
            }),
        },
    })(sources);

    const boardComponent = isolate(BoardComponent, {
        state: {
            get: (state: State) => state.boardComponentState && {
                ...state.boardComponentState,
                currentPrice: state.currentPrice,
                orders: state.orders,
                position: state.position,
                price: state.price,
                stopOrders: state.stopOrders,
            },
            set: (state: State, boardComponentState: BoardComponentState) => ({
                ...state,
                boardComponentState,
                price: boardComponentState.price,
            }),
        },
    })(sources);

    const actions = intent(sources);
    const reducer$ = model(actions);
    const view$ = view(sources.state.stream, boardComponent.DOM, summaryComponent.DOM);
    const request$ = request(actions, sources.state.stream);

    return {
        DOM: view$,
        HTTP: Stream.merge(request$, boardComponent.HTTP, summaryComponent.HTTP),
        router: Stream.never(),
        state: Stream.merge(reducer$, boardComponent.state, summaryComponent.state) as Stream<Reducer<State>>,
        storage: Stream.never(),
    };
};
