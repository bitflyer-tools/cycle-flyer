import Stream from "xstream";
import {Sinks, Sources} from "../";
import {Board} from "../../../models/board";
import {Order} from "../../../models/order";
import {Position} from "../../../models/position";
import {StopOrder} from "../../../models/stopOrder";
import {saveValue} from "../../../storage";
import "./index.styl";
import {groupSizeStorageKey, intent} from "./intent";
import {model} from "./model";
import {request} from "./request";
import {synchronizeBoard} from "./synchronizeBoard";
import {view} from "./view";

export interface State {
    board: Board;
    hasBoardSnapshot?: boolean;
    currentPrice: number;
    groupedSize: number;
    orders: Order[];
    position: Position;
    price: number;
    stopOrders: StopOrder[];
}

export const BoardComponent = (sources: Sources): Sinks => {
    const actions = intent(sources);
    const boardReducer$ = synchronizeBoard(sources.socket.board$, sources.HTTP.select("board"));
    const reducer$ = model(actions, boardReducer$);
    const view$ = view(sources.state.stream as any);
    const request$ = request();

    return {
        DOM: view$,
        HTTP: request$,
        router: Stream.never(),
        state: reducer$ as any,
        storage: saveValue(sources.state.stream as any as Stream<State>, groupSizeStorageKey, (state) => state.groupedSize),
    };
};
