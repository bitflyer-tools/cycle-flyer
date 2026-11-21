import {RequestInput} from "@cycle/http";
import Stream from "xstream";
import {getBoard} from "../../../http";

export const request = (reconnect$: Stream<null>): Stream<RequestInput> =>
    Stream.merge(Stream.periodic(15000), reconnect$).map(() => getBoard()).startWith(getBoard());
