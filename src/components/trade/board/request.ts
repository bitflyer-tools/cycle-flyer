import {RequestOptions} from "@cycle/http";
import Stream from "xstream";
import {getBoard} from "../../../http";

export const request = (): Stream<string | RequestOptions | null> => {
    const board = Stream.periodic(15000).mapTo(getBoard()).startWith(getBoard());
    return Stream.merge(board) as Stream<string | RequestOptions | null>;
};
