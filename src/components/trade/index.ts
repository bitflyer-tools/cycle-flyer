import {DOMSource, VNode} from "@cycle/dom";
import {HTTPSource, RequestInput} from "@cycle/http";
import isolate from "@cycle/isolate";
import {Reducer, StateSource} from "@cycle/state";
import {StorageRequest, StorageSource} from "@cycle/storage";
import {RouterSource} from "cyclic-router";
import Stream from "xstream";
import dropRepeats from "xstream/extra/dropRepeats";
import {SocketIOSource} from "../../drivers/socketIODriver";
import {Sound} from "../../drivers/soundDriver";
import {estimateMarketFills} from "../../models/marketFill";
import {Order} from "../../models/order";
import {OrderHistory} from "../../models/orderHistory";
import {flattenStopOrders, ParentStopOrders} from "../../models/parentStopOrders";
import {Position} from "../../models/position";
import {BoardComponent, State as BoardComponentState} from "./board/index";
import "./index.styl";
import {intent} from "./intent";
import {model} from "./model";
import {OrderComponent, State as OrderComponentState} from "./order";
import {OrderRequestBatch} from "./order/request";
import {request} from "./request";
import {State as SummaryComponentState} from "./summary";
import {SummaryComponent} from "./summary";
import {view} from "./view";

export interface Sources {
    DOM: DOMSource;
    HTTP: HTTPSource;
    orderRequests: HTTPSource;
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
    sound?: Stream<Sound>;
}

export interface State {
    canceledParentOrderIds?: ReadonlyMap<string, number>;
    currentPrice: number | null;
    histories: OrderHistory[];
    orders: Order[];
    parentStopOrders: ParentStopOrders;
    position: Position;
    price: number;
    lastExecutionPrice: number;
    boardComponentState?: BoardComponentState;
    orderComponentState?: OrderComponentState;
    summaryComponentState?: SummaryComponentState;
}

export const Trade = (sources: Sources, isOrdering$: Stream<boolean>): Sinks & {
    orderRequests: Stream<OrderRequestBatch>;
} => {
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
                currentPrice: state.currentPrice ?? 0,
                orders: state.orders,
                position: state.position,
                price: state.price,
                stopOrders: flattenStopOrders(state.parentStopOrders),
            },
            set: (state: State, boardComponentState: BoardComponentState) => ({
                ...state,
                boardComponentState,
                price: boardComponentState.price,
            }),
        },
    })(sources);

    const orderComponent = isolate(OrderComponent, {
        state: {
            get: (state: State) => state.orderComponentState && {
                ...state.orderComponentState,
                marketFills: estimateMarketFills(
                    state.boardComponentState?.hasBoardSnapshot ? state.boardComponentState.board : undefined,
                    state.orderComponentState.size,
                ),
                currentPrice: state.currentPrice ?? 0,
                histories: state.histories,
                orders: state.orders,
                parentStopOrders: state.parentStopOrders,
                position: state.position,
                price: state.price,
            },
            set: (state: State, orderComponentState: OrderComponentState) => ({
                ...state,
                histories: orderComponentState.histories,
                orderComponentState,
                orders: orderComponentState.orders,
                price: orderComponentState.price,
            }),
        },
    })(sources, isOrdering$);

    const actions = intent(sources);
    const reducer$ = model(actions);
    const view$ = view(boardComponent.DOM, summaryComponent.DOM, orderComponent.DOM);
    const request$ = request(actions);

    const priceAlertSound$ = sources.state.stream
        .map((state) => state?.summaryComponentState?.priceAlert)
        .compose(dropRepeats())
        .drop(1)
        .filter((alert) => alert?.status === "triggered")
        .mapTo<Sound>("price-alert");

    return {
        DOM: view$,
        HTTP: Stream.merge(request$, boardComponent.HTTP, summaryComponent.HTTP, orderComponent.HTTP),
        orderRequests: orderComponent.orderRequests,
        router: Stream.never(),
        sound: Stream.merge(
            orderComponent.sound,
            actions.onMyExecutionCreated$.mapTo<Sound>("execution"),
            priceAlertSound$,
        ),
        state: Stream.merge(
            reducer$,
            boardComponent.state,
            summaryComponent.state,
            orderComponent.state,
        ) as Stream<Reducer<State>>,
        storage: Stream.merge(boardComponent.storage, orderComponent.storage),
    };
};
