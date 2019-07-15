import Stream from "xstream";
import {Board} from "../../../models/board";
import {Order} from "../../../models/order";
import {Position} from "../../../models/position";
import {StopOrder} from "../../../models/stopOrder";
import {Sinks, Sources} from "../index";
import "./index.styl";
import {intent} from "./intent";
import {model} from "./model";
import {request} from "./request";
import {view} from "./view";

export interface State {
    board: Board;
    currentPrice: number;
    groupedSize: number;
    orders: Order[];
    position: Position;
    price: number;
    stopOrders: StopOrder[];
}

export const BoardComponent = (sources: Sources): Sinks => {
    const actions = intent(sources);
    const reducer$ = model(actions);
    const view$ = view(sources.onion.state$);
    const request$ = request(actions, sources.onion.state$);

    return {
        DOM: view$,
        HTTP: request$,
        onion: reducer$,
        router: Stream.empty(),
        storage: Stream.empty(),
    };
};
