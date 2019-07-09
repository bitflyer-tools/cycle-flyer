import {RequestInput} from "@cycle/http";
import Stream from "xstream";
import {getBoard} from "../../../http";

export const request = (): Stream<RequestInput> => {
    const board = Stream.periodic(15000).mapTo(getBoard()).startWith(getBoard());
    return Stream.merge(board);
};
